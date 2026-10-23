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
import { stringifyEntityRef, type Entity } from '@backstage/catalog-model';
import { sortEntities } from '../model/entities';

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
): RelatedState {
  const api = useApi(catalogApiRef);
  const refsKey = JSON.stringify(
    [
      ...new Set(
        (entity.relations ?? [])
          .filter(r => r.type === relation)
          .map(r => r.targetRef),
      ),
    ].sort(),
  );
  const refs = useMemo(() => JSON.parse(refsKey) as string[], [refsKey]);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(a => a + 1), []);
  const [state, setState] = useState<{
    key: string;
    loading: boolean;
    entities: Entity[];
    partial: boolean;
    error?: string;
  }>({ key: '', loading: true, entities: [], partial: false });

  useEffect(() => {
    let active = true;
    setState({ key: refsKey, loading: true, entities: [], partial: false });

    async function resolve() {
      try {
        const entities: Entity[] = [];

        for (let i = 0; i < refs.length; i += 100) {
          const batch = refs.slice(i, i + 100);
          const response = await api.getEntitiesByRefs({ entityRefs: batch });

          if (!active) {
            return;
          }

          entities.push(
            ...response.items.filter(
              (v): v is Entity =>
                Boolean(v) && batch.includes(stringifyEntityRef(v!)),
            ),
          );
        }

        const unique = [
          ...new Map(entities.map(v => [stringifyEntityRef(v), v])).values(),
        ].sort(sortEntities);

        if (active) {
          setState({
            key: refsKey,
            loading: false,
            entities: unique,
            partial: unique.length < refs.length,
          });
        }
      } catch {
        if (active) {
          setState({
            key: refsKey,
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
  }, [api, refs, refsKey, attempt]);

  return {
    ...(state.key === refsKey
      ? state
      : { loading: true, entities: [], partial: false }),
    retry,
  };
}
