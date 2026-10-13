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

import { MockAgent, setGlobalDispatcher } from 'undici';
import { mockServices } from '@backstage/backend-test-utils';
import { CatalogInventory } from './catalogInventory';
import { planMutation } from './reconciliation';
import { projectEntity } from './projection';
import { scanFixture, settings } from './testSupport';

describe('prior-inventory prior inventory', () => {
  let agent: MockAgent;
  let inventory: CatalogInventory;
  beforeEach(() => {
    agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
    inventory = new CatalogInventory(
      mockServices.discovery.mock({
        getBaseUrl: async () => 'http://catalog.test/api/catalog',
      }),
      mockServices.auth(),
    );
  });
  afterEach(async () => {
    agent.assertNoPendingInterceptors();
    await agent.close();
  });
  const page = (items: unknown[], totalItems: number, nextCursor?: string) => ({
    items,
    totalItems,
    pageInfo: { ...(nextCursor ? { nextCursor } : {}) },
  });
  it('uses scoped cursor pagination and validates provider-owned DTOs', async () => {
    const projections = planMutation(
      'internal',
      [],
      await scanFixture(),
      settings.providers.internal,
    ).projections;
    const entities = projections.map(projectEntity);
    agent
      .get('http://catalog.test')
      .intercept({
        path: path =>
          path.includes(
            'filter=metadata.annotations.pyxis.redhat.com%2Fprovider-id%3Dpyxis-provider%3Ainternal',
          ),
        method: 'GET',
      })
      .reply(200, page(entities.slice(0, 4), 9, 'next'));
    agent
      .get('http://catalog.test')
      .intercept({ path: path => path.includes('cursor=next'), method: 'GET' })
      .reply(200, page(entities.slice(4), 9));
    expect(await inventory.read('internal', {})).toEqual(projections);
    agent
      .get('http://catalog.test')
      .intercept({ path: '/api/catalog/entities/by-refs', method: 'POST' })
      .reply(200, { items: entities });
    await expect(
      inventory.assertNoConflicts('internal', projections, {}),
    ).resolves.toBeUndefined();
  });
  it.each([
    'loop',
    'later-failure',
    'wrong-total',
    'malformed',
    'duplicate',
    'drift',
    'limit',
  ])('rejects %s without inferring absence', async scenario => {
    const p = planMutation(
      'internal',
      [],
      await scanFixture(),
      settings.providers.internal,
    ).projections[0];
    const entity = projectEntity(p);
    if (scenario === 'drift') entity.metadata.namespace = 'default';
    const first =
      scenario === 'malformed'
        ? {}
        : page(
            [entity],
            { 'wrong-total': 2, limit: 100001 }[scenario] ?? 1,
            ['loop', 'later-failure', 'duplicate'].includes(scenario)
              ? 'next'
              : undefined,
          );
    agent
      .get('http://catalog.test')
      .intercept({ path: /entities\/by-query/, method: 'GET' })
      .reply(200, first);
    if (['loop', 'later-failure', 'duplicate'].includes(scenario))
      agent
        .get('http://catalog.test')
        .intercept({ path: /cursor=next/, method: 'GET' })
        .reply(
          scenario === 'later-failure' ? 503 : 200,
          scenario === 'duplicate' ? page([entity], 1) : page([], 1, 'next'),
        );
    await expect(inventory.read('internal', {})).rejects.toThrow();
  });
  it('propagates cancellation and rejects conflicting host projections', async () => {
    await expect(
      inventory.read('internal', { signal: AbortSignal.abort() }),
    ).rejects.toThrow('cancelled');
    const p = planMutation(
      'internal',
      [],
      await scanFixture(),
      settings.providers.internal,
    ).projections[0];
    const entity = projectEntity(p);
    entity.metadata.annotations!['pyxis.redhat.com/provider-id'] = 'foreign';
    agent
      .get('http://catalog.test')
      .intercept({ path: '/api/catalog/entities/by-refs', method: 'POST' })
      .reply(200, { items: [entity] });
    await expect(
      inventory.assertNoConflicts('internal', [p], {}),
    ).rejects.toThrow('conflict');
  });
});
