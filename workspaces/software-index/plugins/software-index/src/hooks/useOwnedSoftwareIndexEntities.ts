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

import { useMemo } from 'react';
import type { Entity } from '@backstage/catalog-model';
import { PYXIS_RELATIONS } from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import { readEntity, sortEntities } from '../model/entities';
import {
  relatedEntityRefs,
  useEntitiesByRefs,
  type RelatedEntityReadOptions,
} from './useRelatedEntities';

export function useOwnedSoftwareIndexRepositories(
  team: Entity,
  options: RelatedEntityReadOptions = {},
) {
  const directRefs = relatedEntityRefs([team], 'ownerOf');
  const { fields } = options;
  const ownedFields = fields ? [...fields, 'relations'] : undefined;
  const owned = useEntitiesByRefs(directRefs, {
    ...options,
    fields: ownedFields,
  });
  const listings = useMemo(
    () =>
      owned.entities.filter(e => readEntity(e).value?.category === 'listing'),
    [owned.entities],
  );
  const directRefSet = new Set(directRefs);
  const linkedRefs = relatedEntityRefs(
    listings,
    PYXIS_RELATIONS.hasRepository,
  ).filter(ref => !directRefSet.has(ref));
  const linked = useEntitiesByRefs(linkedRefs, options);

  const repositories = useMemo(
    () =>
      [...owned.entities, ...linked.entities]
        .filter(e => readEntity(e).value?.category === 'repository')
        .sort(sortEntities),
    [owned.entities, linked.entities],
  );

  return {
    loading: owned.loading || linked.loading,
    entities: repositories,
    partial: owned.partial || linked.partial,
    error: owned.error ?? linked.error,
    // Resolve ownership again before rebuilding the linked requests.
    retry: owned.retry,
  };
}
