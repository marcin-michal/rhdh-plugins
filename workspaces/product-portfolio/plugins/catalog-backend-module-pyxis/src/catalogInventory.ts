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
import type {
  AuthService,
  DiscoveryService,
} from '@backstage/backend-plugin-api';
import type { PyxisProjection } from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import {
  checkRead,
  sourceRef,
  type ReadOptions,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-node';
import { ownedProjection, providerId } from './projection';

export class CatalogInventory {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly auth: AuthService,
    private readonly maxPages = 1000,
    private readonly maxRecords = 100000,
  ) {}

  private async client(options: ReadOptions) {
    checkRead(options);
    const { token } = await this.auth.getPluginRequestToken({
      onBehalfOf: await this.auth.getOwnServiceCredentials(),
      targetPluginId: 'catalog',
    });
    const signals = options.signal ? [options.signal] : [];

    if (options.deadline !== undefined) {
      signals.push(
        AbortSignal.timeout(Math.max(1, options.deadline - Date.now())),
      );
    }

    const signal = signals.length ? AbortSignal.any(signals) : undefined;
    const catalog = new CatalogClient({
      discoveryApi: this.discovery,
      fetchApi: { fetch: (input, init) => fetch(input, { ...init, signal }) },
    });

    return { catalog, token };
  }

  async read(
    sourceInstance: string,
    options: ReadOptions,
  ): Promise<PyxisProjection[]> {
    const { catalog, token } = await this.client(options);
    const projections = new Map<string, PyxisProjection>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    let total: number | undefined;

    for (let page = 0; page < this.maxPages; page += 1) {
      checkRead(options);
      const result = await catalog.queryEntities(
        cursor
          ? { cursor, limit: 500 }
          : {
              limit: 500,
              filter: {
                'metadata.annotations.pyxis.redhat.com/provider-id':
                  providerId(sourceInstance),
              },
            },
        { token },
      );

      if (
        !Array.isArray(result.items) ||
        !Number.isInteger(result.totalItems) ||
        result.totalItems < 0 ||
        !result.pageInfo ||
        (total !== undefined && total !== result.totalItems)
      ) {
        throw new Error('pyxis-invalid-catalog-page');
      }

      total = result.totalItems;
      if (total > this.maxRecords) {
        throw new Error('pyxis-catalog-record-limit');
      }

      for (const entity of result.items) {
        const p = ownedProjection(entity, sourceInstance);
        const ref = sourceRef(p.source);

        if (projections.has(ref)) {
          throw new Error('pyxis-duplicate-catalog-entry');
        }

        projections.set(ref, p);
      }

      cursor = result.pageInfo.nextCursor;
      if (!cursor) {
        if (projections.size !== total) {
          throw new Error('pyxis-catalog-total-mismatch');
        }

        checkRead(options);

        return [...projections.values()];
      }

      if (
        typeof cursor !== 'string' ||
        cursors.has(cursor) ||
        !result.items.length
      ) {
        throw new Error('pyxis-catalog-cursor-loop');
      }

      cursors.add(cursor);
    }

    throw new Error('pyxis-catalog-page-limit');
  }

  async assertNoConflicts(
    sourceInstance: string,
    projections: readonly PyxisProjection[],
    options: ReadOptions,
  ): Promise<void> {
    const { catalog, token } = await this.client(options);

    for (let offset = 0; offset < projections.length; offset += 500) {
      checkRead(options);
      const batch = projections.slice(offset, offset + 500);
      const result = await catalog.getEntitiesByRefs(
        { entityRefs: batch.map(p => sourceRef(p.source)) },
        { token },
      );

      if (
        !Array.isArray(result.items) ||
        result.items.length !== batch.length
      ) {
        throw new Error('pyxis-invalid-catalog-lookup');
      }

      result.items.forEach((entity, index) => {
        if (!entity) {
          return;
        }

        const p = ownedProjection(entity, sourceInstance);

        if (JSON.stringify(p.source) !== JSON.stringify(batch[index].source)) {
          throw new Error('pyxis-source-key-conflict');
        }
      });
    }
  }
}
