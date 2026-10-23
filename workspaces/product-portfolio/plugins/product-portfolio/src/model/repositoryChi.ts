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
import {
  getRepositoryChiQuality,
  parseRepositoryChiProjection,
  type ChiImageObservation,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import { readEntity, sourceKey } from './entities';

export function readRepositoryChi(entity: Entity, now: number) {
  try {
    const model = readEntity(entity).value;
    if (model?.category !== 'repository') {
      throw new Error('invalid repository');
    }

    const projection = parseRepositoryChiProjection(entity.spec?.pyxisChi);
    if (
      projection.snapshot &&
      sourceKey(projection.snapshot.source) !==
        sourceKey(model.projection.source)
    ) {
      throw new Error('mismatched snapshot');
    }

    return { projection, quality: getRepositoryChiQuality(projection, now) };
  } catch {
    return {
      error: `${stringifyEntityRef(
        entity,
      )}: expected spec.pyxisChi schema 2 for this repository`,
    };
  }
}

export function gradeLabel(image: ChiImageObservation): string {
  if (image.currentGrade === 'A') {
    return image.futureDrops.length
      ? 'A — scheduled deterioration'
      : 'A — stable';
  }

  return image.currentGrade ?? 'Unknown';
}
