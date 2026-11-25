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
import { hasVisibleGrades, readRepositoryChi } from './repositoryChi';

export type SoftwareIndexChiGrade = ChiGrade | 'Unknown';

export interface ImageOccurrence {
  repository: Entity;
  image: ChiImageObservation;
}

export interface SoftwareIndexChiBucket {
  grade: SoftwareIndexChiGrade;
  images: ImageOccurrence[];
}

export interface SoftwareIndexChiSummary {
  aggregate: ReturnType<typeof aggregateRepositoryChi>;
  buckets: SoftwareIndexChiBucket[];
  snapshotsUsed: number;
  latestObservationAt: string | null;
}

export interface SoftwareIndexChiData {
  inputs: Parameters<typeof aggregateRepositoryChi>[0];
  buckets: SoftwareIndexChiBucket[];
  snapshotsUsed: number;
  latestObservationAt: string | null;
}

/** Combines repository-level CHI snapshots for listing, repository, or team views. */
export function collectSoftwareIndexChiData(
  repositories: readonly Entity[],
): SoftwareIndexChiData {
  const unique = new Map(
    repositories.map(entity => [stringifyEntityRef(entity), entity]),
  );
  const inputs = [...unique].map(([repositoryRef, entity]) => ({
    repositoryRef,
    projection: readRepositoryChi(entity, Date.now()).projection ?? null,
  }));

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

  const imagesByGrade = new Map<SoftwareIndexChiGrade, ImageOccurrence[]>();
  for (const { repositoryRef: ref, projection } of inputs) {
    const snapshot = projection?.snapshot;
    if (
      !snapshot ||
      !hasVisibleGrades(projection.state, snapshot.coverage.grades)
    ) {
      continue;
    }

    const repository = unique.get(ref)!;
    const observations = new Map<string, ImageOccurrence>();
    for (const image of snapshot.images) {
      const previous = observations.get(image.imageId);
      if (previous) {
        previous.image = {
          ...previous.image,
          selectedIn: [
            ...new Set([...previous.image.selectedIn, ...image.selectedIn]),
          ],
        };
        continue;
      }

      const occurrence = { repository, image };
      observations.set(image.imageId, occurrence);
      const grade = image.currentGrade ?? 'Unknown';
      const images = imagesByGrade.get(grade) ?? [];
      images.push(occurrence);
      imagesByGrade.set(grade, images);
    }
  }

  const order: SoftwareIndexChiGrade[] = [
    'A',
    'B',
    'C',
    'D',
    'E',
    'F',
    'Unknown',
  ];
  const buckets = order.flatMap(grade => {
    const images = imagesByGrade.get(grade);
    return images ? [{ grade, images }] : [];
  });

  return {
    inputs,
    buckets,
    snapshotsUsed: inputs.filter(i => i.projection?.snapshot).length,
    latestObservationAt,
  };
}

export function summarizeSoftwareIndexChiData(
  data: SoftwareIndexChiData,
  now: number,
): SoftwareIndexChiSummary {
  return {
    aggregate: aggregateRepositoryChi(data.inputs, now),
    buckets: data.buckets,
    snapshotsUsed: data.snapshotsUsed,
    latestObservationAt: data.latestObservationAt,
  };
}

export function aggregateSoftwareIndexChi(
  repositories: readonly Entity[],
  now: number,
): SoftwareIndexChiSummary {
  return summarizeSoftwareIndexChiData(
    collectSoftwareIndexChiData(repositories),
    now,
  );
}
