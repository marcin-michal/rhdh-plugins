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

import { mockServices, startTestBackend } from '@backstage/backend-test-utils';
import { catalogProcessingExtensionPoint } from '@backstage/plugin-catalog-node';
import type { EntityProviderConnection } from '@backstage/plugin-catalog-node';
import {
  PyxisClient,
  PyxisReadError,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-node';
import { CatalogInventory } from './catalogInventory';
import { PyxisProvider } from './provider';
import { baseline, fixtureClient, settings } from './testSupport';
import module from './index';

function harness(paused = false) {
  const client = fixtureClient();
  const scheduler = mockServices.scheduler.mock();
  const catalog = new CatalogInventory(
    mockServices.discovery(),
    mockServices.auth(),
  );

  jest.spyOn(catalog, 'read').mockResolvedValue([]);
  jest.spyOn(catalog, 'assertNoConflicts').mockResolvedValue();

  const logger = mockServices.logger.mock();
  const provider = new PyxisProvider(
    'internal',
    settings.sources.internal,
    { ...settings.providers.internal, paused },
    client,
    catalog,
    scheduler,
    logger,
  );
  const connection = {
    applyMutation: jest.fn(async () => {}),
    refresh: jest.fn(),
  } satisfies EntityProviderConnection;

  return { client, scheduler, catalog, provider, connection, logger };
}

describe('module-behavior module behavior', () => {
  it('registers the real default backend module with absent configuration', async () => {
    const catalog = { addEntityProvider: jest.fn(), addProcessor: jest.fn() };
    const backend = await startTestBackend({
      features: [module, mockServices.rootConfig.factory({ data: {} })],
      extensionPoints: [[catalogProcessingExtensionPoint, catalog]],
    });
    expect(catalog.addEntityProvider).toHaveBeenCalledWith();
    expect(catalog.addProcessor).toHaveBeenCalledTimes(1);
    await backend.stop();
  });

  it('creates stable providers for multiple configured sources and closes clients', async () => {
    const client = fixtureClient();
    const create = jest
      .spyOn(PyxisClient, 'create')
      .mockResolvedValue(client as PyxisClient);
    const catalog = { addEntityProvider: jest.fn(), addProcessor: jest.fn() };
    const backend = await startTestBackend({
      features: [
        module,
        mockServices.rootConfig.factory({
          data: {
            pyxis: {
              sources: {
                internal: { ...settings.sources.internal },
                secondary: { ...settings.sources.internal },
              },
            },
            catalog: { providers: { pyxis: { internal: {}, secondary: {} } } },
          },
        }),
      ],
      extensionPoints: [[catalogProcessingExtensionPoint, catalog]],
    });

    expect(
      catalog.addEntityProvider.mock.calls[0].map((p: PyxisProvider) =>
        p.getProviderName(),
      ),
    ).toEqual(['pyxis-provider:internal', 'pyxis-provider:secondary']);
    await backend.stop();
    expect(client.close).toHaveBeenCalledTimes(2);

    create.mockRestore();
  });

  it('connects before scheduling and keeps paused providers registered', async () => {
    const h = harness(true);
    await h.provider.connect(h.connection);
    expect(h.scheduler.scheduleTask).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'pyxis-provider:internal',
        scope: 'global',
      }),
    );
    await h.provider.run();
    expect(h.client.listListings).not.toHaveBeenCalled();
    await expect(h.provider.connect(h.connection)).rejects.toThrow(
      'already-connected',
    );
    await h.provider.close();
  });
});

describe('preservation-recovery preservation and recovery', () => {
  it('guards failed source/catalog reads and recovers with one delta', async () => {
    const h = harness();
    await expect(h.provider.run()).rejects.toThrow('not-connected');
    await h.provider.connect(h.connection);
    jest
      .mocked(h.client.listListings)
      .mockRejectedValueOnce(new Error('failed page'));
    await h.provider.run();
    expect(h.connection.applyMutation).not.toHaveBeenCalled();
    jest
      .mocked(h.catalog.read)
      .mockRejectedValueOnce(new Error('failed enumeration'));
    await h.provider.run();
    expect(h.connection.applyMutation).not.toHaveBeenCalled();
    await h.provider.run();
    expect(h.connection.applyMutation).toHaveBeenCalledTimes(1);
    expect(h.connection.applyMutation).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'delta', added: expect.any(Array) }),
    );
    await h.provider.close();
  });
});

describe('incomplete scan diagnostics', () => {
  it.each([
    ['VPN', new PyxisReadError('transport', true)],
    ['DNS', new PyxisReadError('transport', true)],
    ['transport', new PyxisReadError('transport', true)],
  ])('logs bounded diagnostics for %s failures', async (_kind, failure) => {
    const h = harness();
    await h.provider.connect(h.connection);
    jest.mocked(h.client.listRepositories).mockRejectedValueOnce(failure);

    await h.provider.run();

    expect(h.logger.warn).toHaveBeenCalledWith(
      'Pyxis scan incomplete; inventory retained',
      expect.objectContaining({
        sourceInstance: 'internal',
        code: 'incomplete-scan',
        diagnostic: {
          code: 'transport',
          operation: 'inventory-scan',
          stage: 'repositories',
          pages: 1,
          records: baseline.listings.length,
          retryable: true,
          durationMs: expect.any(Number),
        },
      }),
    );
    await h.provider.close();
  });

  it('does not log network error text, response bodies or credential material', async () => {
    const h = harness();
    await h.provider.connect(h.connection);
    const secret =
      'Authorization: Bearer source-token; -----BEGIN PRIVATE KEY-----';
    const body = '{"email":"employee@example.test","token":"response-secret"}';
    jest
      .mocked(h.client.listListings)
      .mockRejectedValueOnce(
        new Error(`getaddrinfo ENOTFOUND pyxis.example.test ${secret} ${body}`),
      );

    await h.provider.run();

    const logged = JSON.stringify(h.logger.warn.mock.calls);
    expect(logged).not.toContain(secret);
    expect(logged).not.toContain(body);
    expect(logged).not.toContain('getaddrinfo ENOTFOUND');
    expect(h.logger.warn).toHaveBeenCalledWith(
      'Pyxis scan incomplete; inventory retained',
      expect.objectContaining({
        diagnostic: expect.objectContaining({
          code: 'inventory-failed',
          stage: 'listings',
        }),
      }),
    );
    await h.provider.close();
  });
});

describe('scheduling-database-behavior scheduling and mutation boundaries', () => {
  it('prevents overlapping local runs and aborts before commit', async () => {
    const h = harness();
    await h.provider.connect(h.connection);
    let release!: () => void;
    const barrier = new Promise<void>(resolve => {
      release = resolve;
    });

    jest
      .mocked(h.catalog.assertNoConflicts)
      .mockImplementationOnce(async () => barrier);

    const abort = new AbortController();
    const one = h.provider.run(abort.signal);
    const two = h.provider.run(abort.signal);

    abort.abort();
    release();
    await Promise.all([one, two]);
    expect(h.connection.applyMutation).not.toHaveBeenCalled();
    await h.provider.close();
  });

  it('converges after a mutation acknowledgement is lost', async () => {
    const h = harness();
    await h.provider.connect(h.connection);
    h.connection.applyMutation.mockRejectedValueOnce(
      new Error('acknowledgement lost'),
    );
    await h.provider.run();
    await h.provider.run();
    expect(h.connection.applyMutation).toHaveBeenCalledTimes(2);
    await h.provider.close();
  });
});
