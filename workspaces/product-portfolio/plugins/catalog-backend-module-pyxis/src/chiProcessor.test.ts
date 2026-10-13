/*
 * Copyright Red Hat, Inc.
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

import type { CatalogProcessorCache } from '@backstage/plugin-catalog-node';
import type { JsonValue } from '@backstage/types';
import type {
  RepositoryChiSnapshot,
  PyxisProjection,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import type { PyxisChiReadPort } from '@red-hat-developer-hub/backstage-plugin-pyxis-node';
import { planMutation } from './reconciliation';
import { projectEntity } from './projection';
import { scanFixture, settings } from './testSupport';
import { PyxisChiProcessor } from './chiProcessor';

const observedAt = '2026-10-13T12:00:00.000Z';

async function repositoryEntity() {
  const projection = planMutation(
    'internal',
    [],
    await scanFixture(),
    settings.providers.internal,
  ).projections.find(
    (value): value is PyxisProjection & { source: { kind: 'repository' } } =>
      value.source.kind === 'repository',
  )!;
  return { entity: projectEntity(projection), source: projection.source };
}

const snapshot = (source: {
  sourceInstance: string;
  kind: 'repository';
  id: string;
}): RepositoryChiSnapshot => ({
  schemaVersion: '2',
  normalizationVersion: 'pyxis-chi-v2',
  population: 'latest-published-per-stream-architecture',
  source,
  locator: { registry: 'registry.redhat.io', repository: 'example/component' },
  streamPolicy: {
    tags: ['9.4'],
    origin: 'configured',
    includesMultipleContentStreams: false,
  },
  startedAt: observedAt,
  selectionAt: observedAt,
  observedAt,
  contextCheckedAt: observedAt,
  sourceUpdatedAt: null,
  sourceCalculationFreshness: 'unknown',
  hiddenUntil: null,
  published: true,
  coverage: {
    fetch: 'complete',
    atomic: false,
    allRepositoryImages: false,
    selection: 'complete',
    architectureExpectations: 'unverified',
    grades: 'complete',
    candidatePages: 1,
    candidateRecords: 1,
  },
  issues: [],
  contentHash: '0'.repeat(64),
  streams: [],
  images: [],
  counts: {
    total: 0,
    byGrade: { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, unknown: 0 },
    aWithScheduledDrop: 0,
    byAttention: { ok: 0, warning: 0, problem: 0, unknown: 0 },
  },
});

const cacheHarness = () => {
  const values = new Map<string, JsonValue>();
  const cache: CatalogProcessorCache = {
    get: jest.fn(async key => values.get(key)) as CatalogProcessorCache['get'],
    set: jest.fn(async (key, value) => {
      values.set(key, value);
    }) as CatalogProcessorCache['set'],
  };
  return { cache, values };
};

describe('chi-cache chi-preservation catalog processor', () => {
  it('publishes a complete snapshot and reuses it within the refresh TTL', async () => {
    const { entity, source } = await repositoryEntity();
    const reader: PyxisChiReadPort = {
      readRepository: jest.fn(async () => ({
        state: 'complete' as const,
        snapshot: snapshot(source),
      })),
    };
    const { cache } = cacheHarness();
    const processor = new PyxisChiProcessor(
      {
        internal: {
          reader,
          chi: settings.providers.internal.chi,
          provider: settings.providers.internal,
        },
      },
      new AbortController().signal,
      () => Date.parse('2026-10-13T12:05:00.000Z'),
    );
    const first = await processor.postProcessEntity(
      entity,
      {},
      jest.fn(),
      cache,
    );
    const second = await processor.postProcessEntity(
      first,
      {},
      jest.fn(),
      cache,
    );
    expect(first.spec?.pyxisChi).toMatchObject({
      schemaVersion: '2',
      state: 'ready',
    });
    expect(second.spec?.pyxisChi).toEqual(first.spec?.pyxisChi);
    expect(reader.readRepository).toHaveBeenCalledTimes(1);
  });

  it('retains last-good evidence on a failed refresh', async () => {
    const { entity, source } = await repositoryEntity();
    let time = Date.parse('2026-10-13T12:00:00.000Z');
    const reader: PyxisChiReadPort = {
      readRepository: jest
        .fn()
        .mockResolvedValueOnce({
          state: 'complete',
          snapshot: snapshot(source),
        })
        .mockResolvedValueOnce({
          state: 'unavailable',
          attemptedAt: '2026-10-13T12:20:00.000Z',
          code: 'transport',
        }),
    };
    const { cache } = cacheHarness();
    const processor = new PyxisChiProcessor(
      {
        internal: {
          reader,
          chi: settings.providers.internal.chi,
          provider: settings.providers.internal,
        },
      },
      new AbortController().signal,
      () => time,
    );
    const first = await processor.postProcessEntity(
      entity,
      {},
      jest.fn(),
      cache,
    );
    time = Date.parse('2026-10-13T12:20:00.000Z');
    const failed = await processor.postProcessEntity(
      first,
      {},
      jest.fn(),
      cache,
    );
    expect(failed.spec?.pyxisChi).toMatchObject({
      state: 'ready',
      lastAttempt: { outcome: 'failed', code: 'transport' },
      snapshot: { selectionAt: observedAt },
    });
  });

  it('clears recoverable evidence when CHI is disabled', async () => {
    const { entity } = await repositoryEntity();
    const { cache, values } = cacheHarness();
    const processor = new PyxisChiProcessor(
      {
        internal: {
          reader: { readRepository: jest.fn() },
          chi: { ...settings.providers.internal.chi, enabled: false },
          provider: settings.providers.internal,
        },
      },
      new AbortController().signal,
    );
    const result = await processor.postProcessEntity(
      entity,
      {},
      jest.fn(),
      cache,
    );
    expect(result.spec?.pyxisChi).toMatchObject({
      enabled: false,
      state: 'disabled',
      snapshot: null,
    });
    expect(values.get('chi-v2')).toMatchObject({ lastGood: null });
  });

  it('discards incompatible cache versions and fetches schema v2 evidence', async () => {
    const { entity, source } = await repositoryEntity();
    const { cache, values } = cacheHarness();
    values.set('chi-v2', { version: '1', population: 'floating-tags' });
    const reader: PyxisChiReadPort = {
      readRepository: jest.fn(async () => ({
        state: 'complete' as const,
        snapshot: snapshot(source),
      })),
    };
    const processor = new PyxisChiProcessor(
      {
        internal: {
          reader,
          chi: settings.providers.internal.chi,
          provider: settings.providers.internal,
        },
      },
      new AbortController().signal,
      () => Date.parse('2026-10-13T12:05:00.000Z'),
    );
    const result = await processor.postProcessEntity(
      entity,
      {},
      jest.fn(),
      cache,
    );
    expect(reader.readRepository).toHaveBeenCalledTimes(1);
    expect(result.spec?.pyxisChi).toMatchObject({ schemaVersion: '2' });
    expect(values.get('chi-v2')).toMatchObject({ version: '2' });
  });
});
