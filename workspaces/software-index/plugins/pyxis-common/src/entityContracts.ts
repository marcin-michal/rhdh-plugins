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
import { parsePyxisProjection } from './projectionParsers';
import type { PyxisKind, PyxisProjection } from './index';

/** Provider-owned namespace. @public */
export const PYXIS_NAMESPACE = 'pyxis';
/** Provider annotations shared by catalog processors and browser consumers. @public */
export const PYXIS_ANNOTATIONS = {
  sourceInstance: 'pyxis.redhat.com/source-instance',
  sourceKind: 'pyxis.redhat.com/source-kind',
  sourceId: 'pyxis.redhat.com/source-id',
  providerId: 'pyxis.redhat.com/provider-id',
  projectionVersion: 'pyxis.redhat.com/projection-version',
} as const;
/** Managed entity types. @public */
export const PYXIS_ENTITY_TYPES = {
  listing: 'pyxis-product-listing',
  repository: 'container-repository',
  team: 'team',
} as const;
/** Direct listing associations; raw source arrays are not navigation authority. @public */
export const PYXIS_RELATIONS = {
  hasRepository: 'pyxisHasRepository',
  repositoryOf: 'pyxisRepositoryOf',
} as const;

/** Validate both the DTO and its catalog identity in a single pass. @public */
export function parsePyxisEntity(entity: Entity): PyxisProjection {
  const projection = parsePyxisProjection(entity.spec?.pyxis);
  const category = projection.source.kind;
  const annotations = entity.metadata.annotations;
  if (
    entity.metadata.namespace !== PYXIS_NAMESPACE ||
    entity.kind.toLocaleLowerCase('en-US') !==
      {
        listing: 'resource',
        repository: 'resource',
        team: 'group',
        user: 'user',
      }[category] ||
    annotations?.[PYXIS_ANNOTATIONS.sourceKind] !== category ||
    annotations?.[PYXIS_ANNOTATIONS.projectionVersion] !== '1' ||
    (category !== 'user' &&
      entity.spec?.type !== PYXIS_ENTITY_TYPES[category]) ||
    projection.source.sourceInstance !==
      annotations?.[PYXIS_ANNOTATIONS.sourceInstance] ||
    projection.source.id !== annotations?.[PYXIS_ANNOTATIONS.sourceId]
  )
    throw new Error('Managed Pyxis catalog identity mismatch');
  return projection;
}
function matches(entity: Entity, category: PyxisKind): boolean {
  if (entity.metadata.annotations?.[PYXIS_ANNOTATIONS.sourceKind] !== category)
    return false;
  try {
    return parsePyxisEntity(entity).source.kind === category;
  } catch {
    return false;
  }
}
/** Recognize a validated managed listing. @public */
export function isPyxisListing(entity: Entity): boolean {
  return matches(entity, 'listing');
}
/** Recognize a validated managed repository. @public */
export function isPyxisRepository(entity: Entity): boolean {
  return matches(entity, 'repository');
}
/** Recognize a validated managed team. @public */
export function isPyxisTeam(entity: Entity): boolean {
  return matches(entity, 'team');
}
/** Recognize a validated minimal source user. @public */
export function isPyxisUser(entity: Entity): boolean {
  return matches(entity, 'user');
}
