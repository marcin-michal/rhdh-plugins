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
import {
  CATALOG_FILTER_EXISTS,
  type EntityFilter,
} from '@backstage/plugin-catalog-react';
import { PYXIS_ANNOTATIONS } from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import { readEntity } from '../model/entities';
import { isPortfolioCategory, type FilterState } from './filterState';

export class PortfolioScopeFilter implements EntityFilter {
  getCatalogFilters() {
    return {
      'metadata.namespace': 'pyxis',
      [`metadata.annotations.${PYXIS_ANNOTATIONS.sourceInstance}`]:
        CATALOG_FILTER_EXISTS,
    };
  }
}

export class PortfolioFilter implements EntityFilter {
  private readonly query: string;

  constructor(readonly state: FilterState) {
    this.query = state.q.trim().toLowerCase();
  }

  filterEntity(entity: Entity): boolean {
    const m = readEntity(entity).value;
    if (!m || !isPortfolioCategory(m.category)) {
      return false;
    }

    if (this.state.category !== m.category) {
      return false;
    }

    const q = this.query;
    return (
      !q ||
      [
        m.title,
        entity.metadata.name,
        m.projection.source.id,
        m.path ?? '',
      ].some(v => v.toLowerCase().includes(q))
    );
  }
}
