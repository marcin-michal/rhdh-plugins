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

import type { Entity } from '@backstage/catalog-model';
import { stringifyEntityRef } from '@backstage/catalog-model';
import {
  aggregateRepositoryChi,
  type ChiImageObservation,
  type ChiGrade,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import { readRepositoryChi } from './repositoryChi';

export type PortfolioChiGrade = ChiGrade | 'Unknown';

export interface ImageOccurrence {
  repository: Entity;
  image: ChiImageObservation;
}

export interface PortfolioChiBucket {
  grade: PortfolioChiGrade;
  images: ImageOccurrence[];
}

export interface PortfolioChiSummary {
  aggregate: ReturnType<typeof aggregateRepositoryChi>;
  buckets: PortfolioChiBucket[];
  snapshotsUsed: number;
  latestObservationAt: string | null;
}

/** Combines repository-level CHI snapshots for listing, repository, or team views. */
export function aggregatePortfolioChi(
  repositories: readonly Entity[],
  now: number,
): PortfolioChiSummary {
  const unique = new Map(
    repositories.map(entity => [stringifyEntityRef(entity), entity]),
  );
  const inputs = [...unique].map(([repositoryRef, entity]) => ({
    repositoryRef,
    projection: readRepositoryChi(entity, now).projection ?? null,
  }));
  const aggregate = aggregateRepositoryChi(inputs, now);

  const latestObservationAt = inputs.reduce<string | null>((latest, input) => {
    const observedAt = input.projection?.snapshot?.observedAt;
    if (!observedAt) {
      return latest;
    }

    if (!latest || Date.parse(observedAt) > Date.parse(latest)) {
      return observedAt;
    }

    return latest;
  }, null);

  const observations = new Map<string, ImageOccurrence>();
  for (const { repositoryRef: ref, projection } of inputs) {
    const repository = unique.get(ref)!;
    if (!projection || !['ready', 'partial'].includes(projection.state)) {
      continue;
    }

    for (const image of projection.snapshot?.images ?? []) {
      const key = JSON.stringify([ref, image.imageId]);
      const previous = observations.get(key);

      observations.set(key, {
        repository,
        image: previous
          ? {
              ...previous.image,
              selectedIn: [
                ...new Set([...previous.image.selectedIn, ...image.selectedIn]),
              ],
            }
          : image,
      });
    }
  }

  const order: PortfolioChiGrade[] = ['A', 'B', 'C', 'D', 'E', 'F', 'Unknown'];
  const buckets = order
    .map(grade => ({
      grade,
      images: [...observations.values()].filter(
        v => (v.image.currentGrade ?? 'Unknown') === grade,
      ),
    }))
    .filter(bucket => bucket.images.length > 0);

  return {
    aggregate,
    buckets,
    snapshotsUsed: inputs.filter(i => i.projection?.snapshot).length,
    latestObservationAt,
  };
}
