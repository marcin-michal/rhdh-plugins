/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { setTimeout as delay } from 'node:timers/promises';
import {
  createBackendPlugin,
  coreServices,
  type SchedulerService,
} from '@backstage/backend-plugin-api';
import { schedulerServiceFactory } from '@backstage/backend-defaults/scheduler';
import {
  mockServices,
  startTestBackend,
  TestDatabases,
} from '@backstage/backend-test-utils';
import knexFactory from 'knex';

const databases = TestDatabases.create({ ids: ['SQLITE_3', 'POSTGRES_16'] });
const selected =
  process.env.PYXIS_DATABASE_MATRIX === 'required'
    ? (['SQLITE_3', 'POSTGRES_16'] as const)
    : (['SQLITE_3'] as const);
async function until(
  condition: () => boolean | Promise<boolean>,
  timeout = 15000,
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await delay(25);
  }

  throw new Error('scheduler-convergence-timeout');
}

describe.each(selected)(
  'scheduling-database-behavior real scheduler database coordination on %s',
  databaseId => {
    it('coordinates replicas, propagates timeout and restarts with the same task identity', async () => {
      expect(databases.supports(databaseId)).toBe(true);
      const firstConnection = await databases.init(databaseId);
      const secondConnection =
        databaseId === 'SQLITE_3'
          ? firstConnection
          : knexFactory({
              ...firstConnection.client.config,
              connection: { ...firstConnection.client.config.connection },
            });
      let active = 0;
      let peak = 0;
      let calls = 0;
      let release!: () => void;
      const barrier = new Promise<void>(resolve => {
        release = resolve;
      });
      const task = async () => {
        active += 1;
        calls += 1;
        peak = Math.max(peak, active);
        await barrier;
        active -= 1;
      };

      const start = async (knex: typeof firstConnection) => {
        let scheduler!: SchedulerService;
        const plugin = createBackendPlugin({
          pluginId: 'catalog',
          register(reg) {
            reg.registerInit({
              deps: { scheduler: coreServices.scheduler },
              async init(deps) {
                scheduler = deps.scheduler;
                await scheduler.scheduleTask({
                  id: 'pyxis-provider:internal',
                  frequency: { trigger: 'manual' },
                  timeout: { seconds: 30 },
                  scope: 'global',
                  fn: task,
                });
              },
            });
          },
        });

        const backend = await startTestBackend({
          features: [
            plugin,
            schedulerServiceFactory,
            mockServices.database.factory({ knex }),
          ],
        });

        return { backend, scheduler };
      };

      const first = await start(firstConnection);
      const second = await start(secondConnection);

      try {
        await first.scheduler.triggerTask('pyxis-provider:internal');
        await until(() => active === 1);
        await expect(
          second.scheduler.triggerTask('pyxis-provider:internal'),
        ).rejects.toThrow('currently running');

        expect(calls).toBe(1);
        expect(peak).toBe(1);
        release();
        await until(() => active === 0);
        let aborted = false;

        await first.scheduler.scheduleTask({
          id: 'pyxis-provider:timeout',
          frequency: { trigger: 'manual' },
          timeout: { seconds: 1 },
          scope: 'global',
          fn: async signal =>
            new Promise<void>(resolve => {
              signal.addEventListener(
                'abort',
                () => {
                  aborted = true;
                  resolve();
                },
                { once: true },
              );
            }),
        });
        await first.scheduler.triggerTask('pyxis-provider:timeout');
        await until(() => aborted);
      } finally {
        release();
        await first.backend.stop();
        await second.backend.stop();
      }

      const restarted = await start(firstConnection);
      try {
        await restarted.scheduler.triggerTask('pyxis-provider:internal');
        await until(() => calls === 2);
        expect(peak).toBe(1);
      } finally {
        await restarted.backend.stop();
        if (secondConnection !== firstConnection) {
          await secondConnection.destroy();
        }
      }
    }, 60000);
  },
);
