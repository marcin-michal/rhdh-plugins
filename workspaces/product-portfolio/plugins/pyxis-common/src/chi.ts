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

/** @public */
export type ChiGrade = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

/** @public */
export type ChiAttention = 'ok' | 'warning' | 'problem' | 'unknown';

/** @public */
export type ChiPopulation = 'latest-published-per-stream-architecture';

/** @public */
export type ChiFailureCode =
  | 'authorization'
  | 'transport'
  | 'timeout'
  | 'cancelled'
  | 'graphql'
  | 'source'
  | 'source-not-found'
  | 'validation'
  | 'context-changed'
  | 'selection-changed'
  | 'source-ineligible'
  | 'pagination'
  | 'limit'
  | 'cache-invalid';

/** @public */
export type ChiSelectionIssue =
  | 'streams-not-configured'
  | 'no-published-candidate'
  | 'missing-expected-architecture'
  | 'invalid-architecture'
  | 'invalid-push-date'
  | 'invalid-tag-date'
  | 'conflicting-association'
  | 'tied-latest';

/** @public */
export interface ChiPeriod {
  grade: ChiGrade;
  startAt: string;
  endAt: string | null;
  createdAt: string | null;
}

/** @public */
export interface ChiDrop {
  from: ChiGrade;
  to: ChiGrade;
  at: string;
}

/** @public */
export interface ChiImageMetadata {
  /** Active tags for this image in the selected repository at selection time. */
  activeTags: readonly string[];
  /** Architecture-specific manifest digest from the winning association. */
  manifestDigest: string | null;
  /** Multi-architecture manifest-list digest, when Pyxis provides one. */
  manifestListDigest: string | null;
  /** Publication date shared by the winning associations, when unambiguous. */
  publishedAt: string | null;
}

/** @public */
export interface ChiImageObservation extends ChiImageMetadata {
  imageId: string;
  architecture: string;
  selectedIn: readonly string[];
  pushDates: Readonly<Record<string, string>>;
  currentGrade: ChiGrade | null;
  gradeOrigin: 'normalized-source-periods';
  gradeQuality: 'known' | 'unknown' | 'inconsistent' | 'hidden';
  periodEvidence: 'valid' | 'absent' | 'inconsistent' | 'hidden';
  periods: readonly ChiPeriod[];
  futureDrops: readonly ChiDrop[];
  attention: ChiAttention;
}

/** @public */
export interface ChiCounts {
  total: number;
  byGrade: Record<ChiGrade, number> & { unknown: number };
  aWithScheduledDrop: number;
  byAttention: Record<ChiAttention, number>;
}

/** @public */
export interface ChiStreamSelection {
  tag: string;
  architectures: {
    basis: 'configured' | 'observed-only';
    expected: readonly string[] | null;
    observed: readonly string[];
    missing: readonly string[];
  };
  slots: readonly {
    architecture: string;
    state: 'selected' | 'missing' | 'uncertain';
    imageId: string | null;
    pushDate: string | null;
    reason: ChiSelectionIssue | null;
  }[];
  issues: readonly ChiSelectionIssue[];
  counts: ChiCounts;
  worstKnownGrade: ChiGrade | null;
  earliestDrop: (ChiDrop & { imageId: string; architecture: string }) | null;
}

/** @public */
export interface RepositoryChiSnapshot {
  schemaVersion: '2';
  normalizationVersion: 'pyxis-chi-v2';
  population: ChiPopulation;
  source: SourceKey<'repository'>;
  locator: { registry: string; repository: string };
  streamPolicy: {
    tags: readonly string[];
    origin: 'configured' | 'latest-fallback' | 'unconfigured';
    includesMultipleContentStreams: boolean | null;
  };
  startedAt: string;
  selectionAt: string;
  observedAt: string;
  contextCheckedAt: string;
  sourceUpdatedAt: string | null;
  sourceCalculationFreshness: 'unknown';
  hiddenUntil: string | null;
  published: boolean | null;
  coverage: {
    fetch: 'complete';
    atomic: false;
    allRepositoryImages: false;
    selection: 'complete' | 'partial';
    architectureExpectations: 'verified' | 'unverified';
    grades: 'complete' | 'partial' | 'hidden';
    candidatePages: number;
    candidateRecords: number;
  };
  issues: readonly ChiSelectionIssue[];
  contentHash: string;
  streams: readonly ChiStreamSelection[];
  images: readonly ChiImageObservation[];
  counts: ChiCounts;
}

/** @public */
export interface RepositoryChiProjection {
  schemaVersion: '2';
  enabled: boolean;
  staleAfterSeconds: number;
  state: 'ready' | 'partial' | 'empty' | 'hidden' | 'unavailable' | 'disabled';
  lastAttempt: {
    at: string;
    outcome: 'complete' | 'failed';
    code?: ChiFailureCode;
  } | null;
  suppression: { hiddenUntil: string; observedAt: string } | null;
  snapshot: RepositoryChiSnapshot | null;
}

/** @public */
export interface ChiSnapshotQuality {
  availability:
    | 'known'
    | 'partial'
    | 'empty'
    | 'hidden'
    | 'unavailable'
    | 'disabled';
  stale: boolean;
  refreshFailed: boolean;
  transitionDue: boolean;
  selectionIncomplete: boolean;
  architectureCoverageUnverified: boolean;
}

/** @public */
export interface ChiAggregateInput {
  repositoryRef: string;
  projection: RepositoryChiProjection | null;
}

/** @public */
export interface ChiAggregate {
  schemaVersion: '2';
  countingUnit: 'selected-repository-image-occurrences';
  counts: ChiCounts;
  repositories: {
    total: number;
    ready: number;
    partial: number;
    empty: number;
    hidden: number;
    unavailable: number;
    disabled: number;
    stale: number;
    refreshFailed: number;
    transitionDue: number;
    architectureCoverageUnverified: number;
  };
  streams: {
    total: number;
    incomplete: number;
    missingArchitectureSlots: number;
  };
  oldestObservationAt: string | null;
  complete: boolean;
}
