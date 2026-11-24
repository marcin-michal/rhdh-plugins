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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import type { Entity } from '@backstage/catalog-model';
import { sortEntities } from '../model/entities';

const SMALL_BATCH_SIZE = 100;

export interface RelatedEntityReadOptions {
  fields?: string[];
  smallBatches?: boolean;
}

export interface RelatedState {
  loading: boolean;
  entities: Entity[];
  partial: boolean;
  error?: string;
  retry: () => void;
}

export function useRelatedEntities(
  entity: Entity,
  relation: string,
  options?: RelatedEntityReadOptions,
): RelatedState {
  return useEntitiesByRefs(relatedEntityRefs([entity], relation), options);
}

export function relatedEntityRefs(
  entities: readonly Entity[],
  relation: string,
): string[] {
  return entities.flatMap(entity =>
    (entity.relations ?? [])
      .filter(r => r.type === relation)
      .map(r => r.targetRef),
  );
}

export function useEntitiesByRefs(
  entityRefs: readonly string[],
  { fields, smallBatches = false }: RelatedEntityReadOptions = {},
): RelatedState {
  const api = useApi(catalogApiRef);
  const queryKey = JSON.stringify({
    entityRefs: [...new Set(entityRefs)].sort(),
    fields,
    smallBatches,
  });
  const query = useMemo(
    () =>
      JSON.parse(queryKey) as RelatedEntityReadOptions & {
        entityRefs: string[];
      },
    [queryKey],
  );
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(a => a + 1), []);
  const requestKey = `${attempt}:${queryKey}`;
  const [state, setState] = useState<{
    key: string;
    loading: boolean;
    entities: Entity[];
    partial: boolean;
    error?: string;
  }>({ key: '', loading: true, entities: [], partial: false });

  useEffect(() => {
    let active = true;
    setState({ key: requestKey, loading: true, entities: [], partial: false });

    async function resolve() {
      try {
        const {
          entityRefs: refs,
          smallBatches: limitBatchSize,
          ...options
        } = query;
        const batchSize = limitBatchSize ? SMALL_BATCH_SIZE : refs.length;
        const entities: Entity[] = [];

        for (let i = 0; i < refs.length; i += batchSize) {
          const { items } = await api.getEntitiesByRefs({
            ...options,
            entityRefs: limitBatchSize ? refs.slice(i, i + batchSize) : refs,
          });

          if (!active) {
            return;
          }

          for (const entity of items) {
            if (entity) {
              entities.push(entity);
            }
          }
        }

        setState({
          key: requestKey,
          loading: false,
          entities: entities.sort(sortEntities),
          partial: entities.length < refs.length,
        });
      } catch {
        if (active) {
          setState({
            key: requestKey,
            loading: false,
            entities: [],
            partial: false,
            error: 'Related catalog data could not be loaded.',
          });
        }
      }
    }

    resolve();

    return () => {
      active = false;
    };
  }, [api, query, requestKey]);

  return {
    ...(state.key === requestKey
      ? state
      : { loading: true, entities: [], partial: false }),
    retry,
  };
}
