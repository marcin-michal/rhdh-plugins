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
import { PYXIS_RELATIONS } from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import { readEntity, sortEntities } from '../model/entities';
import {
  useRelatedEntities,
  useRelatedEntitiesFromEntities,
} from './useRelatedEntities';

export function useOwnedPortfolioEntities(team: Entity) {
  const state = useRelatedEntities(team, 'ownerOf');
  const managed = state.entities.filter(e =>
    ['listing', 'repository'].includes(readEntity(e).value?.category ?? ''),
  );

  return {
    ...state,
    entities: managed,
    listings: managed.filter(e => readEntity(e).value?.category === 'listing'),
    repositories: managed.filter(
      e => readEntity(e).value?.category === 'repository',
    ),
  };
}

export function useOwnedPortfolioRepositories(team: Entity) {
  const owned = useOwnedPortfolioEntities(team);
  const linked = useRelatedEntitiesFromEntities(
    owned.listings,
    PYXIS_RELATIONS.hasRepository,
  );
  const repositories = new Map<string, Entity>();

  for (const repository of [...owned.repositories, ...linked.entities]) {
    if (readEntity(repository).value?.category === 'repository') {
      repositories.set(stringifyEntityRef(repository), repository);
    }
  }

  return {
    loading: owned.loading || linked.loading,
    entities: [...repositories.values()].sort(sortEntities),
    partial: owned.partial || linked.partial,
    error: owned.error ?? linked.error,
    retry: () => {
      owned.retry();
      linked.retry();
    },
  };
}
