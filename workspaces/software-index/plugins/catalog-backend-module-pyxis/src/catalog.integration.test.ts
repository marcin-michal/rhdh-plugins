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

import catalogBackend from '@backstage/plugin-catalog-backend';
import { setTimeout as delay } from 'node:timers/promises';
import {
  createBackendModule,
  createServiceFactory,
  coreServices,
  type SchedulerServiceTaskInvocationDefinition,
} from '@backstage/backend-plugin-api';
import {
  mockCredentials,
  mockServices,
  startTestBackend,
  TestDatabases,
} from '@backstage/backend-test-utils';
import { catalogProcessingExtensionPoint } from '@backstage/plugin-catalog-node';
import type { Entity } from '@backstage/catalog-model';
import { MockAgent, setGlobalDispatcher } from 'undici';
import { PyxisClient } from '@red-hat-developer-hub/backstage-plugin-pyxis-node';
import { baseline, settings } from './testSupport';
import module from './index';

const databases = TestDatabases.create({ ids: ['SQLITE_3', 'POSTGRES_16'] });
const selected =
  process.env.PYXIS_DATABASE_MATRIX === 'required'
    ? (['SQLITE_3', 'POSTGRES_16'] as const)
    : (['SQLITE_3'] as const);

describe.each(selected)(
  'processed-catalog-graph preservation-recovery processed catalog graph and restart on %s',
  databaseId => {
    it.each(['redhat-only', 'redhat-or-unlabeled'] as const)(
      'preserves nine source entities and their relationships across failure, recovery and restart with %s',
      async initialPolicy => {
        expect(databases.supports(databaseId)).toBe(true);
        const knex = await databases.init(databaseId);
        let failure = false;
        const fixture =
          initialPolicy === 'redhat-only'
            ? baseline
            : {
                ...baseline,
                listings: baseline.listings.map(
                  ({ vendor_label: _vendor, ...record }, index) =>
                    index === 0 ? { ...record, vendor_label: null } : record,
                ),
                repositories: baseline.repositories.map(
                  ({ vendor_label: _vendor, ...record }) => record,
                ),
              };
        const runBackend = async (vendorPolicy = initialPolicy) => {
          const agent = new MockAgent();
          agent.disableNetConnect();
          agent.enableNetConnect(/^(localhost|127\.0\.0\.1):\d+$/);
          setGlobalDispatcher(agent);
          agent
            .get('https://pyxis.example.test')
            .intercept({ path: '/graphql', method: 'POST' })
            .reply(options => {
              const request = JSON.parse(String(options.body));
              if (failure) return { statusCode: 503, data: '{}' };
              const query = request.query as string;
              const operation = query.match(
                /(find_product_listings|find_repositories|get_team)\(/,
              )?.[1];
              if (!operation) throw new Error('unexpected inventory operation');
              const data = {
                find_product_listings: fixture.listings,
                find_repositories: fixture.repositories,
                get_team: baseline.teams.find(
                  team => team._id === request.variables.id,
                ),
              }[operation];
              return {
                statusCode: 200,
                data: JSON.stringify({
                  data: {
                    [operation]: {
                      error: null,
                      data,
                      ...(Array.isArray(data)
                        ? { page: 0, page_size: 100, total: data.length }
                        : {}),
                    },
                  },
                }),
              };
            })
            .persist();
          const create = jest
            .spyOn(PyxisClient, 'create')
            .mockImplementation(
              async (config, id) =>
                new PyxisClient({ ...config, maxAttempts: 1 }, agent, id),
            );
          let task: SchedulerServiceTaskInvocationDefinition | undefined;
          const scheduler = mockServices.scheduler.mock({
            scheduleTask: async invocation => {
              if (invocation.id === 'pyxis-provider:internal')
                task = invocation;
            },
          });
          const hostEntity: Entity = {
            apiVersion: 'backstage.io/v1alpha1',
            kind: 'User',
            metadata: {
              name: 'host-user',
              namespace: 'default',
              annotations: {
                'backstage.io/managed-by-location': 'test:host',
                'backstage.io/managed-by-origin-location': 'test:host',
              },
            },
            spec: { memberOf: [] },
          };
          const hostProvider = createBackendModule({
            pluginId: 'catalog',
            moduleId: 'test-host',
            register(reg) {
              reg.registerInit({
                deps: { catalog: catalogProcessingExtensionPoint },
                async init({ catalog }) {
                  catalog.addEntityProvider({
                    getProviderName: () => 'test-host',
                    connect: async connection => {
                      await connection.applyMutation({
                        type: 'full',
                        entities: [
                          { entity: hostEntity, locationKey: 'test-host' },
                        ],
                      });
                    },
                  });
                },
              });
            },
          });
          const backend = await startTestBackend({
            features: [
              catalogBackend,
              module,
              hostProvider,
              mockServices.database.factory({ knex }),
              createServiceFactory({
                service: coreServices.scheduler,
                deps: {},
                factory: () => scheduler,
              }),
              mockServices.rootConfig.factory({
                data: {
                  backend: {
                    auth: { dangerouslyDisableDefaultAuthPolicy: true },
                  },
                  catalog: {
                    rules: [{ allow: ['Resource', 'Group', 'User'] }],
                    processingInterval: { seconds: 1 },
                    providers: { pyxis: { internal: { vendorPolicy } } },
                  },
                  pyxis: {
                    sources: { internal: { ...settings.sources.internal } },
                  },
                },
              }),
            ],
          });
          create.mockRestore();
          const query = async (): Promise<Entity[]> => {
            const response = await fetch(
              `http://localhost:${backend.server.port()}/api/catalog/entities`,
              {
                headers: {
                  authorization: `Bearer ${mockCredentials.service.token()}`,
                },
              },
            );
            if (!response.ok)
              throw new Error(`catalog-query-${response.status}`);
            return response.json();
          };
          const synchronize = async () => {
            if (!task) throw new Error('provider was not scheduled');
            await task.fn(new AbortController().signal);
          };
          const settle = async () => {
            const deadline = Date.now() + 30000;
            let entities: Entity[] = [];
            while (Date.now() < deadline) {
              entities = await query();
              if (
                entities.length === 10 &&
                entities
                  .flatMap(entity => entity.relations ?? [])
                  .filter(relation => relation.type === 'pyxisHasRepository')
                  .length === 3
              )
                return entities;
              await delay(100);
            }
            throw new Error(
              `catalog-convergence-timeout: ${JSON.stringify(
                entities.map(e => ({
                  kind: e.kind,
                  title: e.metadata.title,
                  relations: e.relations,
                })),
              )}`,
            );
          };
          return { backend, query, synchronize, settle, agent };
        };
        const first = await runBackend();
        try {
          await first.synchronize();
          const entities = await first.settle();
          const source = entities.filter(
            entity => entity.metadata.namespace === 'pyxis',
          );
          expect(source).toHaveLength(9);
          expect(
            source
              .filter(entity => entity.kind === 'Resource')
              .map(
                entity =>
                  (entity.spec?.pyxis as { vendor: { policy: string } }).vendor
                    .policy,
              ),
          ).toEqual(Array(5).fill(initialPolicy));
          expect(source.filter(entity => entity.kind === 'User')).toHaveLength(
            2,
          );
          expect(
            source.filter(
              entity => entity.spec?.type === 'container-repository',
            ),
          ).toHaveLength(3);
          const unlisted = source.find(
            entity => entity.metadata.title === 'Unlisted',
          );
          expect(unlisted).toBeDefined();
          expect(
            unlisted?.relations?.some(
              relation => relation.type === 'pyxisRepositoryOf',
            ),
          ).toBe(false);
          expect(
            source
              .filter(entity => entity.kind === 'Resource')
              .every(entity =>
                entity.relations?.some(relation => relation.type === 'ownedBy'),
              ),
          ).toBe(true);
          expect(
            source
              .flatMap(entity => entity.relations ?? [])
              .filter(relation => relation.type === 'pyxisRepositoryOf'),
          ).toHaveLength(3);
          expect(
            source.find(entity => entity.metadata.title === 'Shared'),
          ).toBeDefined();
          expect(
            entities.find(entity => entity.metadata.name === 'host-user')?.spec,
          ).toEqual({ memberOf: [] });
          failure = true;
          await first.synchronize();
          expect(
            (await first.query()).map(entity => entity.metadata.uid).sort(),
          ).toEqual(entities.map(entity => entity.metadata.uid).sort());
          failure = false;
          await first.synchronize();
          await first.settle();
          first.agent.assertNoPendingInterceptors();
        } finally {
          await first.backend.stop();
        }
        // A broad-to-strict change preserves previously admitted unlabeled projections.
        const restarted = await runBackend('redhat-only');
        try {
          expect(await restarted.query()).toHaveLength(10);
          await restarted.synchronize();
          expect(await restarted.settle()).toHaveLength(10);
          restarted.agent.assertNoPendingInterceptors();
        } finally {
          await restarted.backend.stop();
        }
      },
      90000,
    );
  },
);
