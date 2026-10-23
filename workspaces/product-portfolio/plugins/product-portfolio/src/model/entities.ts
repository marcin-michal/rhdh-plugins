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
  parsePyxisEntity,
  type PyxisKind,
  type PyxisProjection,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-common';

export interface PortfolioEntity {
  entity: Entity;
  ref: string;
  category: PyxisKind;
  projection: PyxisProjection;
  title: string;
  description?: string;
  path?: string;
  updatedAt?: string;
}

export type EntityModel =
  | { value: PortfolioEntity; error?: never }
  | { value?: never; error: string };

const cache = new WeakMap<Entity, EntityModel>();

export function readEntity(entity: Entity): EntityModel {
  const existing = cache.get(entity);
  if (existing) {
    return existing;
  }

  const ref = stringifyEntityRef(entity);
  try {
    const projection = parsePyxisEntity(entity);
    const category = projection.source.kind;
    const record = projection.record;

    const path =
      record && 'registry' in record && 'repository' in record
        ? [record.registry, record.repository].filter(Boolean).join('/')
        : undefined;

    let sourceDescription: string | null | undefined;
    if (record && 'descriptions' in record) {
      sourceDescription = record.descriptions?.short;
    } else if (record && 'display_data' in record) {
      sourceDescription = record.display_data?.short_description;
    }

    const recordUpdatedAt =
      record?.last_update_date ??
      (record && 'metrics' in record
        ? record.metrics?.last_update_date
        : undefined);

    const result = {
      value: {
        entity,
        ref,
        category,
        projection,
        title: entity.metadata.title ?? entity.metadata.name,
        description: sourceDescription?.trim() || entity.metadata.description,
        path,
        updatedAt: recordUpdatedAt ?? projection.observation.sourceUpdatedAt,
      },
    };
    cache.set(entity, result);

    return result;
  } catch {
    const result = {
      error: `${ref}: expected spec.pyxis version 1 and matching managed entity identity`,
    };
    cache.set(entity, result);

    return result;
  }
}

export function sourceKey(key: {
  sourceInstance: string;
  kind: string;
  id: string;
}): string {
  return JSON.stringify([key.sourceInstance, key.kind, key.id]);
}

export function sortEntities(a: Entity, b: Entity): number {
  return (
    (a.metadata.title ?? a.metadata.name).localeCompare(
      b.metadata.title ?? b.metadata.name,
    ) || stringifyEntityRef(a).localeCompare(stringifyEntityRef(b))
  );
}
