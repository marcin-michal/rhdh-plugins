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

import { CatalogClient } from '@backstage/catalog-client';
import { stringifyEntityRef } from '@backstage/catalog-model';
import type { CatalogApi } from '@backstage/plugin-catalog-react';
import { portfolioFixtures } from './entities';

export function fixtureCatalog(): CatalogApi {
  const size = Number(
    new URLSearchParams(window.location.search).get('fixtureCount'),
  );
  const entities = portfolioFixtures(
    Number.isSafeInteger(size) && size > 0 ? size : 32,
  );
  const byRef = new Map(entities.map(e => [stringifyEntityRef(e), e]));
  const base = new CatalogClient({
    discoveryApi: { getBaseUrl: async () => '/api/catalog' },
  });
  return Object.assign(base, {
    getEntities: async (request?: Parameters<CatalogApi['getEntities']>[0]) => {
      const filters = Array.isArray(request?.filter)
        ? request.filter
        : [request?.filter ?? {}];
      const scoped = filters.some(f => f['metadata.namespace'] === 'pyxis');
      if (window.location.pathname === '/product-portfolio' && !scoped)
        throw new Error('Portfolio attempted an unscoped catalog request');
      return {
        items: entities.filter(
          e => !scoped || e.metadata.namespace === 'pyxis',
        ),
      };
    },
    getEntitiesByRefs: async (
      request: Parameters<CatalogApi['getEntitiesByRefs']>[0],
    ) => ({ items: request.entityRefs.map(ref => byRef.get(ref)) }),
    getEntityByRef: async (ref: Parameters<CatalogApi['getEntityByRef']>[0]) =>
      byRef.get(typeof ref === 'string' ? ref : stringifyEntityRef(ref)),
    queryEntities: async () => ({
      items: entities,
      totalItems: entities.length,
      pageInfo: {},
    }),
    getEntityFacets: async () => ({
      facets: {
        kind: [
          { value: 'Resource', count: 27 },
          { value: 'Group', count: 2 },
          { value: 'User', count: 3 },
          { value: 'Component', count: 1 },
        ],
      },
    }),
    getEntityAncestors: async () => ({ rootEntityRef: '', items: [] }),
  });
}
