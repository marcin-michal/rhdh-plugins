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

import type {
  ChiAggregate,
  ChiAggregateInput,
  ChiCounts,
  ChiSnapshotQuality,
  RepositoryChiProjection,
} from './chi';

const emptyCounts = (): ChiCounts => ({
  total: 0,
  byGrade: { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, unknown: 0 },
  aWithScheduledDrop: 0,
  byAttention: { ok: 0, warning: 0, problem: 0, unknown: 0 },
});

const dueBoundary = (projection: RepositoryChiProjection, now: number) => {
  const snapshot = projection.snapshot;
  if (!snapshot) {
    return false;
  }

  const observed = Date.parse(snapshot.observedAt);
  const candidates = snapshot.images.flatMap(image =>
    image.periods.flatMap(period => [period.startAt, period.endAt]),
  );

  if (projection.suppression) {
    candidates.push(projection.suppression.hiddenUntil);
  }

  return candidates.some(value => {
    if (!value) {
      return false;
    }
    const boundary = Date.parse(value);

    return boundary > observed && boundary <= now;
  });
};

/** @public */
export function getRepositoryChiQuality(
  value: RepositoryChiProjection,
  now: number,
): ChiSnapshotQuality {
  const snapshot = value.snapshot;
  const availability = {
    ready: 'known',
    partial: 'partial',
    empty: 'empty',
    hidden: 'hidden',
    unavailable: 'unavailable',
    disabled: 'disabled',
  }[value.state] as ChiSnapshotQuality['availability'];

  return {
    availability,
    stale:
      value.state !== 'disabled' &&
      (!snapshot ||
        now >=
          Date.parse(snapshot.selectionAt) + value.staleAfterSeconds * 1000),
    refreshFailed: value.lastAttempt?.outcome === 'failed',
    transitionDue: dueBoundary(value, now),
    selectionIncomplete: snapshot?.coverage.selection !== 'complete',
    architectureCoverageUnverified:
      snapshot?.coverage.architectureExpectations !== 'verified',
  };
}

const addCounts = (target: ChiCounts, value: ChiCounts) => {
  target.total += value.total;
  for (const grade of ['A', 'B', 'C', 'D', 'E', 'F', 'unknown'] as const) {
    target.byGrade[grade] += value.byGrade[grade];
  }

  target.aWithScheduledDrop += value.aWithScheduledDrop;

  for (const attention of ['ok', 'warning', 'problem', 'unknown'] as const) {
    target.byAttention[attention] += value.byAttention[attention];
  }
};

/** Aggregate authorized direct repository observations for a listing. @public */
export function aggregateRepositoryChi(
  values: readonly ChiAggregateInput[],
  now: number,
): ChiAggregate {
  const unique = new Map<string, RepositoryChiProjection | null>();
  for (const value of values) {
    const existing = unique.get(value.repositoryRef);
    if (unique.has(value.repositoryRef)) {
      if (JSON.stringify(existing) !== JSON.stringify(value.projection)) {
        throw new Error('pyxis-chi-conflicting-repository');
      }
      continue;
    }

    unique.set(value.repositoryRef, value.projection);
  }

  const result: ChiAggregate = {
    schemaVersion: '2',
    countingUnit: 'selected-repository-image-occurrences',
    counts: emptyCounts(),
    repositories: {
      total: unique.size,
      ready: 0,
      partial: 0,
      empty: 0,
      hidden: 0,
      unavailable: 0,
      disabled: 0,
      stale: 0,
      refreshFailed: 0,
      transitionDue: 0,
      architectureCoverageUnverified: 0,
    },
    streams: { total: 0, incomplete: 0, missingArchitectureSlots: 0 },
    oldestObservationAt: null,
    complete: unique.size > 0,
  };

  for (const projection of unique.values()) {
    if (!projection) {
      result.repositories.unavailable += 1;
      result.repositories.stale += 1;
      result.complete = false;
      continue;
    }

    result.repositories[projection.state] += 1;
    const quality = getRepositoryChiQuality(projection, now);
    if (quality.stale) {
      result.repositories.stale += 1;
    }
    if (quality.refreshFailed) {
      result.repositories.refreshFailed += 1;
    }
    if (quality.transitionDue) {
      result.repositories.transitionDue += 1;
    }
    if (quality.architectureCoverageUnverified) {
      result.repositories.architectureCoverageUnverified += 1;
    }

    const snapshot = projection.snapshot;
    if (snapshot) {
      addCounts(result.counts, snapshot.counts);
      result.streams.total += snapshot.streams.length;
      result.streams.incomplete += snapshot.streams.filter(
        stream =>
          stream.issues.length > 0 ||
          stream.slots.some(slot => slot.state !== 'selected'),
      ).length;
      result.streams.missingArchitectureSlots += snapshot.streams.reduce(
        (count, stream) =>
          count + stream.slots.filter(slot => slot.state === 'missing').length,
        0,
      );

      if (
        result.oldestObservationAt === null ||
        snapshot.observedAt < result.oldestObservationAt
      ) {
        result.oldestObservationAt = snapshot.observedAt;
      }
    }

    if (
      projection.state !== 'ready' ||
      quality.stale ||
      quality.refreshFailed ||
      quality.transitionDue ||
      quality.selectionIncomplete ||
      quality.architectureCoverageUnverified
    ) {
      result.complete = false;
    }
  }

  return result;
}
