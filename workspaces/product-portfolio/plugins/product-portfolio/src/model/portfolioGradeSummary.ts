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

import { stringifyEntityRef, type Entity } from '@backstage/catalog-model';
import type {
  ChiCounts,
  RepositoryChiProjection,
  RepositoryChiSnapshot,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import { readEntity, sourceKey } from './entities';
import { hasVisibleGrades } from './repositoryChi';

export const knownGrades = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

export const gradeSummaryFields = [
  'apiVersion',
  'kind',
  'metadata.name',
  'metadata.namespace',
  'metadata.title',
  'metadata.annotations',
  'spec.type',
  'spec.pyxis',
  'spec.pyxisChi.schemaVersion',
  'spec.pyxisChi.state',
  'spec.pyxisChi.snapshot.schemaVersion',
  'spec.pyxisChi.snapshot.normalizationVersion',
  'spec.pyxisChi.snapshot.population',
  'spec.pyxisChi.snapshot.source',
  'spec.pyxisChi.snapshot.observedAt',
  'spec.pyxisChi.snapshot.coverage.grades',
  'spec.pyxisChi.snapshot.counts.byGrade',
  'spec.pyxisChi.snapshot.counts.aWithScheduledDrop',
];

type GradeSnapshot = Pick<
  RepositoryChiSnapshot,
  | 'schemaVersion'
  | 'normalizationVersion'
  | 'population'
  | 'source'
  | 'observedAt'
> & {
  coverage: Pick<RepositoryChiSnapshot['coverage'], 'grades'>;
  counts: Pick<ChiCounts, 'byGrade' | 'aWithScheduledDrop'>;
};

type GradeProjection = Pick<
  RepositoryChiProjection,
  'schemaVersion' | 'state'
> & {
  snapshot?: GradeSnapshot | null;
};

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function readRepositoryGradeSummary(entity: Entity) {
  const repository = readEntity(entity).value;
  const projection = entity.spec?.pyxisChi as GradeProjection | undefined;
  const snapshot = projection?.snapshot;
  if (
    repository?.category !== 'repository' ||
    projection?.schemaVersion !== '2' ||
    !['ready', 'partial', 'empty', 'hidden', 'unavailable'].includes(
      projection.state,
    ) ||
    snapshot?.schemaVersion !== '2' ||
    snapshot.normalizationVersion !== 'pyxis-chi-v2' ||
    snapshot.population !== 'latest-published-per-stream-architecture' ||
    !snapshot.source ||
    sourceKey(snapshot.source) !== sourceKey(repository.projection.source) ||
    !['complete', 'partial', 'hidden'].includes(snapshot.coverage?.grades) ||
    typeof snapshot.observedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(
      snapshot.observedAt,
    ) ||
    !Number.isFinite(Date.parse(snapshot.observedAt))
  ) {
    return undefined;
  }

  if (!hasVisibleGrades(projection.state, snapshot.coverage.grades)) {
    return { observedAt: snapshot.observedAt };
  }

  const counts = snapshot.counts;
  if (
    !isCount(counts?.aWithScheduledDrop) ||
    !knownGrades.every(grade => isCount(counts.byGrade?.[grade])) ||
    counts.aWithScheduledDrop > counts.byGrade.A
  ) {
    return undefined;
  }

  return { observedAt: snapshot.observedAt, counts };
}

export function summarizePortfolioGrades(repositories: readonly Entity[]) {
  const byGrade = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 };
  let aWithScheduledDrop = 0;
  let latestObservationAt: string | null = null;
  const unique = new Map(
    repositories.map(repository => [
      stringifyEntityRef(repository),
      repository,
    ]),
  );

  for (const repository of unique.values()) {
    const summary = readRepositoryGradeSummary(repository);
    if (!summary) {
      continue;
    }

    if (
      !latestObservationAt ||
      Date.parse(summary.observedAt) > Date.parse(latestObservationAt)
    ) {
      latestObservationAt = summary.observedAt;
    }

    if (summary.counts) {
      aWithScheduledDrop += summary.counts.aWithScheduledDrop;
      for (const grade of knownGrades) {
        byGrade[grade] += summary.counts.byGrade[grade];
      }
    }
  }

  return { byGrade, aWithScheduledDrop, latestObservationAt };
}
