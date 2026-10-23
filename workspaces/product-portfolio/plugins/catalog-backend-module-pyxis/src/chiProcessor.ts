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

import {
  PYXIS_ANNOTATIONS,
  PYXIS_ENTITY_TYPES,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import { createHash } from 'node:crypto';
import { metrics } from '@opentelemetry/api';
import { stringifyEntityRef, type Entity } from '@backstage/catalog-model';
import type { JsonObject, JsonValue } from '@backstage/types';
import type {
  CatalogProcessor,
  CatalogProcessorCache,
  CatalogProcessorEmit,
} from '@backstage/plugin-catalog-node';
import {
  getRepositoryChiQuality,
  type ChiImageObservation,
  type RepositoryChiProjection,
  type RepositoryChiSnapshot,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import {
  countChiImages,
  hashChiSnapshotEvidence,
  type PyxisChiConfig,
  type PyxisChiReadPort,
  type PyxisProviderConfig,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-node';
import { ownedProjection } from './projection';

const CACHE_KEY = 'chi-v2';

export interface PyxisChiRuntime {
  reader: PyxisChiReadPort;
  chi: PyxisChiConfig;
  provider: PyxisProviderConfig;
}

interface ChiCacheState {
  version: '2';
  source: { sourceInstance: string; kind: 'repository'; id: string };
  entityRef: string;
  configFingerprint: string;
  suppression: { hiddenUntil: string; observedAt: string } | null;
  lastGood: RepositoryChiSnapshot | null;
  lastAttempt: RepositoryChiProjection['lastAttempt'];
}

const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stable);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stable(nested)]),
    );
  }

  return value;
};

const fingerprint = (runtime: PyxisChiRuntime, repositoryId: string) =>
  createHash('sha256')
    .update(
      JSON.stringify(
        stable({
          normalizationVersion: 'pyxis-chi-v2',
          population: 'latest-published-per-stream-architecture',
          latestFallback: true,
          expectedArchitectures:
            runtime.chi.expectedArchitectures[repositoryId.toLowerCase()] ?? {},
          vendorPolicy: runtime.provider.vendorPolicy,
          maxCandidatePages: runtime.chi.maxCandidatePages,
          maxCandidateRecords: runtime.chi.maxCandidateRecords,
          maxStreams: runtime.chi.maxStreams,
          maxArchitectureSlots: runtime.chi.maxArchitectureSlots,
          maxImages: runtime.chi.maxImages,
          maxPeriodsPerImage: runtime.chi.maxPeriodsPerImage,
          maxSnapshotBytes: runtime.chi.maxSnapshotBytes,
        }),
      ),
    )
    .digest('hex');

const validDate = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));

const validSnapshot = (
  value: unknown,
  source: ChiCacheState['source'],
  maxBytes: number,
): value is RepositoryChiSnapshot => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const snapshot = value as RepositoryChiSnapshot;

  return (
    snapshot.schemaVersion === '2' &&
    snapshot.normalizationVersion === 'pyxis-chi-v2' &&
    snapshot.population === 'latest-published-per-stream-architecture' &&
    JSON.stringify(snapshot.source) === JSON.stringify(source) &&
    validDate(snapshot.selectionAt) &&
    validDate(snapshot.observedAt) &&
    Array.isArray(snapshot.streams) &&
    Array.isArray(snapshot.images) &&
    typeof snapshot.contentHash === 'string' &&
    /^[a-f0-9]{64}$/.test(snapshot.contentHash) &&
    Buffer.byteLength(JSON.stringify(snapshot)) <= maxBytes
  );
};

const parseCache = (
  value: JsonValue | undefined,
  source: ChiCacheState['source'],
  entityRef: string,
  configFingerprint: string,
  maxBytes: number,
): ChiCacheState | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const cache = value as unknown as ChiCacheState;
  if (
    cache.version !== '2' ||
    JSON.stringify(cache.source) !== JSON.stringify(source) ||
    cache.entityRef !== entityRef ||
    cache.configFingerprint !== configFingerprint ||
    (cache.lastGood !== null &&
      !validSnapshot(cache.lastGood, source, maxBytes)) ||
    (cache.lastAttempt !== null &&
      (!validDate(cache.lastAttempt.at) ||
        !['complete', 'failed'].includes(cache.lastAttempt.outcome))) ||
    (cache.suppression !== null &&
      (!validDate(cache.suppression.hiddenUntil) ||
        !validDate(cache.suppression.observedAt)))
  ) {
    return null;
  }

  return cache;
};

const snapshotState = (
  snapshot: RepositoryChiSnapshot | null,
  suppression: ChiCacheState['suppression'],
): RepositoryChiProjection['state'] => {
  if (suppression && Date.parse(suppression.hiddenUntil) >= Date.now()) {
    return 'hidden';
  }

  if (!snapshot) {
    return 'unavailable';
  }

  if (snapshot.coverage.grades === 'hidden') {
    return 'hidden';
  }

  const honestlyEmpty =
    snapshot.streams.length > 0 &&
    snapshot.images.length === 0 &&
    snapshot.issues.length > 0 &&
    snapshot.issues.every(issue => issue === 'no-published-candidate');
  if (honestlyEmpty) {
    return 'empty';
  }

  if (
    snapshot.coverage.selection !== 'complete' ||
    snapshot.coverage.grades !== 'complete'
  ) {
    return 'partial';
  }

  return 'ready';
};

const projection = (
  config: PyxisChiConfig,
  cache: ChiCacheState,
): RepositoryChiProjection => ({
  schemaVersion: '2',
  enabled: true,
  staleAfterSeconds: config.staleAfterSeconds,
  state: snapshotState(cache.lastGood, cache.suppression),
  lastAttempt: cache.lastAttempt,
  suppression: cache.suppression,
  snapshot: cache.lastGood,
});

const maskImage = (image: ChiImageObservation): ChiImageObservation => ({
  ...image,
  currentGrade: null,
  gradeQuality: 'hidden',
  periodEvidence: 'hidden',
  periods: [],
  futureDrops: [],
  attention: 'unknown',
});

const maskSnapshot = (
  snapshot: RepositoryChiSnapshot,
  suppression: NonNullable<ChiCacheState['suppression']>,
): RepositoryChiSnapshot => {
  const images = snapshot.images.map(maskImage);
  const streams = snapshot.streams.map(stream => {
    const selected = images.filter(image =>
      image.selectedIn.includes(stream.tag),
    );

    return {
      ...stream,
      counts: countChiImages(selected),
      worstKnownGrade: null,
      earliestDrop: null,
    };
  });

  const masked: RepositoryChiSnapshot = {
    ...snapshot,
    contextCheckedAt: suppression.observedAt,
    hiddenUntil: suppression.hiddenUntil,
    coverage: { ...snapshot.coverage, grades: 'hidden' },
    streams,
    images,
    counts: countChiImages(images),
    contentHash: '',
  };
  masked.contentHash = hashChiSnapshotEvidence(masked);

  return masked;
};

const asJson = <T>(value: T): JsonValue =>
  JSON.parse(JSON.stringify(value)) as JsonValue;

/** Cache-backed repository enrichment, separate from provider ownership. */
export class PyxisChiProcessor implements CatalogProcessor {
  private readonly meter = metrics.getMeter('pyxis-consumer', '1');
  private readonly refresh = this.meter.createCounter('pyxis.chi.refresh');
  private readonly duration = this.meter.createHistogram(
    'pyxis.chi.refresh.duration',
    { unit: 's' },
  );
  private readonly cacheMetric = this.meter.createCounter('pyxis.chi.cache');
  private readonly snapshotBytes = this.meter.createHistogram(
    'pyxis.chi.snapshot.bytes',
  );
  private readonly observationAge = this.meter.createHistogram(
    'pyxis.chi.observation.age',
    { unit: 's' },
  );
  private readonly images = this.meter.createHistogram('pyxis.chi.images');
  private readonly failures = this.meter.createCounter('pyxis.chi.failure');

  constructor(
    private readonly runtimes: Readonly<Record<string, PyxisChiRuntime>>,
    private readonly shutdown: AbortSignal,
    private readonly clock: () => number = Date.now,
  ) {}

  getProcessorName(): string {
    return 'PyxisChiProcessor';
  }

  async postProcessEntity(
    entity: Entity,
    _location: unknown,
    _emit: CatalogProcessorEmit,
    processorCache: CatalogProcessorCache,
  ): Promise<Entity> {
    const sourceInstance =
      entity.metadata.annotations?.[PYXIS_ANNOTATIONS.sourceInstance];
    const runtime = sourceInstance ? this.runtimes[sourceInstance] : undefined;

    if (
      !runtime ||
      entity.kind !== 'Resource' ||
      entity.spec?.type !== PYXIS_ENTITY_TYPES.repository ||
      entity.metadata.annotations?.[PYXIS_ANNOTATIONS.sourceKind] !==
        'repository'
    ) {
      return entity;
    }

    const owned = ownedProjection(entity, sourceInstance!);
    if (owned.source.kind !== 'repository') {
      return entity;
    }

    const source = { ...owned.source, kind: 'repository' as const };
    const entityRef = stringifyEntityRef(entity);
    const configFingerprint = fingerprint(runtime, source.id);

    if (!runtime.chi.enabled) {
      const cleared: ChiCacheState = {
        version: '2',
        source,
        entityRef,
        configFingerprint,
        suppression: null,
        lastGood: null,
        lastAttempt: null,
      };
      await processorCache.set(CACHE_KEY, asJson(cleared));

      return this.withProjection(entity, {
        schemaVersion: '2',
        enabled: false,
        staleAfterSeconds: runtime.chi.staleAfterSeconds,
        state: 'disabled',
        lastAttempt: null,
        suppression: null,
        snapshot: null,
      });
    }

    const cachedValue = await processorCache.get<JsonValue>(CACHE_KEY);
    let cached = parseCache(
      cachedValue,
      source,
      entityRef,
      configFingerprint,
      runtime.chi.maxSnapshotBytes,
    );
    let cacheResult = 'invalid';

    if (cached) {
      cacheResult = 'hit';
    } else if (cachedValue === undefined) {
      cacheResult = 'miss';
    }

    this.cacheMetric.add(1, { sourceInstance, result: cacheResult });
    if (!cached) {
      cached = {
        version: '2',
        source,
        entityRef,
        configFingerprint,
        suppression: null,
        lastGood: null,
        lastAttempt: null,
      };
    }

    const now = this.clock();
    const current = projection(runtime.chi, cached);
    const interval =
      cached.lastAttempt?.outcome === 'failed'
        ? runtime.chi.retryIntervalSeconds
        : runtime.chi.refreshIntervalSeconds;
    const reusable =
      cached.lastAttempt !== null &&
      now < Date.parse(cached.lastAttempt.at) + interval * 1000 &&
      !getRepositoryChiQuality(current, now).transitionDue;

    if (reusable) {
      if (cached.lastGood) {
        this.observationAge.record(
          Math.max(0, now - Date.parse(cached.lastGood.selectionAt)) / 1000,
          { sourceInstance },
        );
      }

      await processorCache.set(CACHE_KEY, asJson(cached));
      return this.withProjection(entity, current);
    }

    const started = this.clock();
    const result = await runtime.reader.readRepository(source, {
      signal: this.shutdown,
      deadline: started + runtime.chi.readTimeoutSeconds * 1000,
    });
    let outcome: 'complete' | 'empty' | 'hidden' | 'failed' | 'cancelled' =
      'failed';

    if (result.state === 'complete') {
      cached.lastGood = result.snapshot;
      cached.suppression =
        result.snapshot.coverage.grades === 'hidden' &&
        result.snapshot.hiddenUntil
          ? {
              hiddenUntil: result.snapshot.hiddenUntil,
              observedAt: result.snapshot.contextCheckedAt,
            }
          : null;
      cached.lastAttempt = {
        at: result.snapshot.contextCheckedAt,
        outcome: 'complete',
      };

      const next = projection(runtime.chi, cached);
      outcome = 'complete';

      if (next.state === 'empty') {
        outcome = 'empty';
      } else if (next.state === 'hidden') {
        outcome = 'hidden';
      }

      this.snapshotBytes.record(
        Buffer.byteLength(JSON.stringify(result.snapshot)),
        {
          sourceInstance,
        },
      );
      this.images.record(result.snapshot.images.length, { sourceInstance });
    } else {
      cached.lastAttempt = {
        at: result.attemptedAt,
        outcome: 'failed',
        code: result.code,
      };

      if (result.suppression) {
        cached.suppression = result.suppression;
        if (cached.lastGood) {
          cached.lastGood = maskSnapshot(cached.lastGood, result.suppression);
        }
      }

      outcome = result.code === 'cancelled' ? 'cancelled' : 'failed';
      this.failures.add(1, { sourceInstance, code: result.code });
    }

    if (this.shutdown.aborted) {
      return entity;
    }

    await processorCache.set(CACHE_KEY, asJson(cached));
    this.refresh.add(1, { sourceInstance, outcome });
    this.duration.record((this.clock() - started) / 1000, {
      sourceInstance,
      outcome,
    });

    return this.withProjection(entity, projection(runtime.chi, cached));
  }

  private withProjection(entity: Entity, chi: RepositoryChiProjection): Entity {
    return {
      ...entity,
      spec: {
        ...entity.spec,
        pyxisChi: asJson(chi) as JsonObject,
      },
    };
  }
}
