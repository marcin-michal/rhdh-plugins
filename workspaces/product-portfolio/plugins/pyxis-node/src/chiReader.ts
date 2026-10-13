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

import type { SourceKey } from '@red-hat-developer-hub/backstage-plugin-product-portfolio-common';
import type {
  ChiFailureCode,
  RepositoryChiSnapshot,
  VendorPolicy,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import type { PyxisChiConfig, PyxisSourceConfig } from './config';
import {
  hashChiSnapshotEvidence,
  normalizeChiImage,
  countChiImages,
  summarizeChiStreams,
} from './chiNormalization';
import {
  ChiSelectionAccumulator,
  type ChiSelectionOptions,
  type ChiSelectionWinner,
} from './chiSelection';
import { PyxisReadError, checkRead } from './client';
import { classifyVendor } from './normalization';
import type {
  PyxisChiReadClient,
  PyxisChiReadPort,
  ReadOptions,
  RepositoryChiContext,
  RepositoryChiReadResult,
  SelectedImageChi,
} from './ports';

const MAX_ACTIVE_REPOSITORIES = 64;

class ChiReadFailure extends Error {
  constructor(
    readonly code: ChiFailureCode,
    readonly suppression?: { hiddenUntil: string; observedAt: string },
  ) {
    super(`pyxis-chi-${code}`);
  }
}

const normalizeTags = (
  context: RepositoryChiContext,
): {
  tags: string[];
  origin: 'configured' | 'latest-fallback' | 'unconfigured';
} => {
  if (context.contentStreamTags?.length) {
    return {
      tags: [...new Set(context.contentStreamTags)].sort(),
      origin: 'configured',
    };
  }

  if (context.includesMultipleContentStreams === true) {
    return { tags: [], origin: 'unconfigured' };
  }

  return { tags: ['latest'], origin: 'latest-fallback' };
};

const activeHiding = (hiddenUntil: string | null, at: string) =>
  hiddenUntil !== null &&
  Number.isFinite(Date.parse(hiddenUntil)) &&
  hiddenUntil >= at;

const contextIdentity = (
  context: RepositoryChiContext,
  policy: VendorPolicy,
) => ({
  id: context.id,
  registry: context.registry,
  repository: context.repository,
  vendor: classifyVendor(
    context.vendor.wirePresence === 'present'
      ? { vendor_label: context.vendor.wireValue }
      : {},
    policy,
  ).decision,
  published: context.published,
  hiddenUntil: context.hiddenUntil,
  streams: normalizeTags(context),
  includesMultipleContentStreams: context.includesMultipleContentStreams,
});

const failureCode = (error: unknown): ChiFailureCode => {
  if (error instanceof ChiReadFailure) {
    return error.code;
  }

  if (error instanceof PyxisReadError) {
    return {
      authorization: 'authorization',
      transport: 'transport',
      http: 'transport',
      deadline: 'timeout',
      cancelled: 'cancelled',
      graphql: 'graphql',
      source: 'source',
      validation: 'validation',
      limit: 'limit',
      pagination: 'pagination',
    }[error.code] as ChiFailureCode;
  }

  if (error instanceof Error && error.message.includes('limit')) {
    return 'limit';
  }

  return 'validation';
};

const assertEligible = (
  context: RepositoryChiContext,
  source: SourceKey<'repository'>,
  sourceInstance: string,
  policy: VendorPolicy,
) => {
  const identity = contextIdentity(context, policy);
  if (
    source.sourceInstance !== sourceInstance ||
    context.id !== source.id ||
    identity.vendor !== 'admit' ||
    context.published !== true
  ) {
    throw new ChiReadFailure('source-ineligible');
  }
};

/** @public */
export class RepositoryChiReader implements PyxisChiReadPort {
  private readonly active = new Map<string, Promise<RepositoryChiReadResult>>();

  constructor(
    private readonly sourceInstance: string,
    private readonly client: PyxisChiReadClient,
    private readonly sourceConfig: PyxisSourceConfig,
    private readonly config: PyxisChiConfig,
    private readonly vendorPolicy: VendorPolicy,
    private readonly clock: () => number = Date.now,
  ) {}

  readRepository(
    source: SourceKey<'repository'>,
    options: ReadOptions,
  ): Promise<RepositoryChiReadResult> {
    const existing = this.active.get(source.id);
    if (existing) {
      return existing;
    }

    if (this.active.size >= MAX_ACTIVE_REPOSITORIES) {
      return Promise.resolve({
        state: 'unavailable',
        attemptedAt: new Date(this.clock()).toISOString(),
        code: 'limit',
      });
    }

    const read = this.perform(source, options).finally(() => {
      this.active.delete(source.id);
    });

    this.active.set(source.id, read);

    return read;
  }

  private async perform(
    source: SourceKey<'repository'>,
    input: ReadOptions,
  ): Promise<RepositoryChiReadResult> {
    const startedAt = new Date(this.clock()).toISOString();
    const attemptedAt = startedAt;
    const deadline = Math.min(
      input.deadline ?? Number.POSITIVE_INFINITY,
      this.clock() + this.config.readTimeoutSeconds * 1000,
    );
    const options = { ...input, deadline };

    try {
      const first = await this.client.getRepositoryChiContext(
        source.id,
        options,
      );
      if (first.state === 'not-found') {
        throw new ChiReadFailure('source-not-found');
      }

      const initial = first.data;
      assertEligible(initial, source, this.sourceInstance, this.vendorPolicy);

      const streamPolicy = normalizeTags(initial);
      if (streamPolicy.tags.length > this.config.maxStreams) {
        throw new ChiReadFailure('limit');
      }

      const selectionAt = new Date(this.clock()).toISOString();
      const initiallyHidden = activeHiding(initial.hiddenUntil, selectionAt);
      const expected =
        this.config.expectedArchitectures[source.id.toLowerCase()] ?? {};
      const selectionOptions: ChiSelectionOptions = {
        registry: initial.registry,
        repository: initial.repository,
        streams: streamPolicy.tags,
        selectionAt,
        expectedArchitectures: expected,
        maxStreams: this.config.maxStreams,
        maxArchitectureSlots: this.config.maxArchitectureSlots,
      };
      const selector = new ChiSelectionAccumulator(selectionOptions);
      let pages = 0;
      let records = 0;
      let afterId: string | undefined;

      if (streamPolicy.tags.length > 0) {
        const maxPages = Math.min(
          this.config.maxCandidatePages,
          this.sourceConfig.maxPages,
        );
        const maxRecords = Math.min(
          this.config.maxCandidateRecords,
          this.sourceConfig.maxRecords,
        );

        for (let page = 0; page < maxPages; page += 1) {
          checkRead(options);
          const result = await this.client.listRepositoryChiCandidates({
            ...options,
            registry: initial.registry,
            repository: initial.repository,
            streams: streamPolicy.tags,
            afterId,
            pageSize: this.sourceConfig.pageSize,
          });
          pages += 1;

          if (
            result.page !== 0 ||
            result.pageSize !== this.sourceConfig.pageSize ||
            result.data.length > this.sourceConfig.pageSize
          ) {
            throw new ChiReadFailure('pagination');
          }

          let previous = afterId;
          for (const candidate of result.data) {
            if (previous && candidate._id <= previous) {
              throw new ChiReadFailure('pagination');
            }
            previous = candidate._id;

            records += 1;
            if (records > maxRecords) {
              throw new ChiReadFailure('limit');
            }

            selector.add(candidate);
          }

          if (result.data.length < this.sourceConfig.pageSize) {
            break;
          }

          afterId = previous;
          if (!afterId || page + 1 >= maxPages || records >= maxRecords) {
            throw new ChiReadFailure('limit');
          }
        }
      }

      let plan = selector.finish();
      if (streamPolicy.origin === 'unconfigured') {
        plan = {
          ...plan,
          issues: ['streams-not-configured'],
          complete: false,
        };
      }

      if (plan.winners.length > this.config.maxImages) {
        throw new ChiReadFailure('limit');
      }

      const selected = new Map<string, SelectedImageChi>();
      await Promise.all(
        plan.winners.map(async winner => {
          const result = await this.client.getSelectedImageChi(winner.imageId, {
            ...options,
            includeGrades: !initiallyHidden,
          });
          if (result.state === 'not-found') {
            throw new ChiReadFailure('selection-changed');
          }

          this.revalidateWinner(winner, result.data, selectionOptions);
          selected.set(winner.imageId, result.data);
        }),
      );

      const observedAt = new Date(this.clock()).toISOString();
      const finalLookup = await this.client.getRepositoryChiContext(
        source.id,
        options,
      );
      if (finalLookup.state === 'not-found') {
        throw new ChiReadFailure('context-changed');
      }

      const final = finalLookup.data;
      const finalHidden = activeHiding(final.hiddenUntil, observedAt);
      const suppression = finalHidden
        ? { hiddenUntil: final.hiddenUntil!, observedAt }
        : undefined;

      if (
        JSON.stringify(contextIdentity(initial, this.vendorPolicy)) !==
        JSON.stringify(contextIdentity(final, this.vendorPolicy))
      ) {
        throw new ChiReadFailure('context-changed', suppression);
      }
      if (initiallyHidden && !finalHidden) {
        throw new ChiReadFailure('context-changed', {
          hiddenUntil: initial.hiddenUntil!,
          observedAt,
        });
      }

      const images = plan.winners.map(winner =>
        normalizeChiImage(
          winner,
          selected.get(winner.imageId)?.freshness_grades,
          observedAt,
          finalHidden,
          this.config.maxPeriodsPerImage,
        ),
      );

      const streams = summarizeChiStreams(plan, images);
      const expectationsVerified =
        streamPolicy.tags.length > 0 &&
        streamPolicy.tags.every(tag => Object.hasOwn(expected, tag));
      let grades: RepositoryChiSnapshot['coverage']['grades'] = 'partial';
      if (finalHidden) {
        grades = 'hidden';
      } else if (images.every(image => image.gradeQuality === 'known')) {
        grades = 'complete';
      }

      const draft: RepositoryChiSnapshot = {
        schemaVersion: '2',
        normalizationVersion: 'pyxis-chi-v2',
        population: 'latest-published-per-stream-architecture',
        source,
        locator: { registry: final.registry, repository: final.repository },
        streamPolicy: {
          tags: streamPolicy.tags,
          origin: streamPolicy.origin,
          includesMultipleContentStreams: final.includesMultipleContentStreams,
        },
        startedAt,
        selectionAt,
        observedAt,
        contextCheckedAt: new Date(this.clock()).toISOString(),
        sourceUpdatedAt: final.sourceUpdatedAt,
        sourceCalculationFreshness: 'unknown',
        hiddenUntil: final.hiddenUntil,
        published: final.published,
        coverage: {
          fetch: 'complete',
          atomic: false,
          allRepositoryImages: false,
          selection: plan.complete ? 'complete' : 'partial',
          architectureExpectations: expectationsVerified
            ? 'verified'
            : 'unverified',
          grades,
          candidatePages: pages,
          candidateRecords: records,
        },
        issues: plan.issues,
        contentHash: '',
        streams,
        images,
        counts: countChiImages(images),
      };
      draft.contentHash = hashChiSnapshotEvidence(draft);
      if (
        Buffer.byteLength(JSON.stringify(draft)) > this.config.maxSnapshotBytes
      ) {
        throw new ChiReadFailure('limit');
      }
      return { state: 'complete', snapshot: draft };
    } catch (error) {
      return {
        state: 'unavailable',
        attemptedAt,
        code: failureCode(error),
        ...(error instanceof ChiReadFailure && error.suppression
          ? { suppression: error.suppression }
          : {}),
      };
    }
  }

  private revalidateWinner(
    winner: ChiSelectionWinner,
    selected: SelectedImageChi,
    options: ChiSelectionOptions,
  ): void {
    const selector = new ChiSelectionAccumulator({
      ...options,
      streams: winner.selectedIn,
      expectedArchitectures: undefined,
    });
    selector.add(selected);
    const current = selector
      .finish()
      .winners.find(value => value.imageId === winner.imageId);

    if (
      !current ||
      current.architecture !== winner.architecture ||
      JSON.stringify(current.selectedIn) !==
        JSON.stringify(winner.selectedIn) ||
      JSON.stringify(current.pushDates) !== JSON.stringify(winner.pushDates) ||
      JSON.stringify(current.fingerprints) !==
        JSON.stringify(winner.fingerprints)
    ) {
      throw new ChiReadFailure('selection-changed');
    }
  }
}
