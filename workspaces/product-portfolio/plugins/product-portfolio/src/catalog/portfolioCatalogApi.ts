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

import {
  CATALOG_FILTER_EXISTS,
  type CatalogApi,
} from '@backstage/plugin-catalog-react';
import {
  PYXIS_ANNOTATIONS,
  PYXIS_NAMESPACE,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import { readEntity, sourceKey } from '../model/entities';
import type { PortfolioTeam } from './columns';
import type { PortfolioCategory } from './filterState';

const TEAM_DIRECTORY_FIELDS = [
  'kind',
  'metadata.name',
  'metadata.namespace',
  'metadata.title',
  'metadata.annotations',
  'spec.type',
  'spec.pyxis',
];

export const PORTFOLIO_ENTITY_FIELDS = [
  ...TEAM_DIRECTORY_FIELDS,
  'metadata.description',
  'metadata.uid',
  'relations',
];

export const PORTFOLIO_SEARCH_FIELDS: string[] = [
  'metadata.title',
  'metadata.name',
  'spec.pyxis.source.id',
  'spec.pyxis.record.registry',
  'spec.pyxis.record.repository',
];

export function portfolioEntityFilter(category: PortfolioCategory) {
  return {
    'metadata.namespace': PYXIS_NAMESPACE,
    [`metadata.annotations.${PYXIS_ANNOTATIONS.sourceInstance}`]:
      CATALOG_FILTER_EXISTS,
    [`metadata.annotations.${PYXIS_ANNOTATIONS.sourceKind}`]: category,
  };
}

export async function fetchPortfolioTeamDirectory(
  catalogApi: CatalogApi,
): Promise<ReadonlyMap<string, PortfolioTeam>> {
  const teams = new Map<string, PortfolioTeam>();
  const pages = catalogApi.streamEntities({
    filter: portfolioEntityFilter('team'),
    pageSize: 200,
    fields: TEAM_DIRECTORY_FIELDS,
  });

  for await (const entities of pages) {
    for (const entity of entities) {
      const model = readEntity(entity).value;
      if (model?.category !== 'team') {
        continue;
      }

      const record = model.projection.record;
      const name =
        record && 'name' in record && typeof record.name === 'string'
          ? record.name.trim()
          : '';
      const label = name || entity.metadata.title?.trim();
      if (!label) {
        continue;
      }

      const team: PortfolioTeam = { entity, ref: model.ref, label };
      teams.set(model.ref, team);
      teams.set(sourceKey(model.projection.source), team);
    }
  }

  return teams;
}
