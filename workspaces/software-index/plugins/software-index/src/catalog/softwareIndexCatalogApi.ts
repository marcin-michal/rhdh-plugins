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

import { stringifyEntityRef } from '@backstage/catalog-model';
import type { CatalogApi } from '@backstage/plugin-catalog-react';
import {
  PYXIS_ANNOTATIONS,
  PYXIS_ENTITY_TYPES,
  PYXIS_NAMESPACE,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import { sourceKey } from '../model/entities';
import type { SoftwareIndexTeam } from './columns';
import type { SoftwareIndexCategory } from './filterState';

const ENTITY_LABEL_FIELDS = [
  'kind',
  'metadata.name',
  'metadata.namespace',
  'metadata.title',
];

const TEAM_DIRECTORY_FIELDS = [
  ...ENTITY_LABEL_FIELDS,
  `metadata.annotations.${PYXIS_ANNOTATIONS.sourceId}`,
  `metadata.annotations.${PYXIS_ANNOTATIONS.projectionVersion}`,
  'spec.type',
  'spec.pyxis.source.sourceInstance',
  'spec.pyxis.record.name',
];

export const SOFTWARE_INDEX_ENTITY_FIELDS = [
  ...ENTITY_LABEL_FIELDS,
  'metadata.annotations',
  'spec.type',
  'spec.pyxis',
  'metadata.description',
  'metadata.uid',
  'relations',
];

export const SOFTWARE_INDEX_SEARCH_FIELDS: string[] = [
  'metadata.title',
  'metadata.name',
  'spec.pyxis.source.id',
  'spec.pyxis.record.registry',
  'spec.pyxis.record.repository',
];

export function softwareIndexEntityFilter(category: SoftwareIndexCategory) {
  return {
    'metadata.namespace': PYXIS_NAMESPACE,
    [`metadata.annotations.${PYXIS_ANNOTATIONS.sourceKind}`]: category,
  };
}

export async function fetchSoftwareIndexTeamDirectory(
  catalogApi: CatalogApi,
): Promise<ReadonlyMap<string, SoftwareIndexTeam>> {
  const teams = new Map<string, SoftwareIndexTeam>();
  const pages = catalogApi.streamEntities({
    filter: softwareIndexEntityFilter('team'),
    pageSize: 200,
    fields: TEAM_DIRECTORY_FIELDS,
  });

  for await (const entities of pages) {
    for (const entity of entities) {
      const annotations = entity.metadata.annotations;
      const id = annotations?.[PYXIS_ANNOTATIONS.sourceId];
      const isTeam =
        entity.kind.toLowerCase() === 'group' &&
        entity.spec?.type === PYXIS_ENTITY_TYPES.team &&
        annotations?.[PYXIS_ANNOTATIONS.projectionVersion] === '1';
      if (!isTeam || !id) {
        continue;
      }

      const projection = entity.spec?.pyxis as
        | { source?: { sourceInstance?: unknown }; record?: { name?: unknown } }
        | undefined;
      const recordName = projection?.record?.name;
      const name = typeof recordName === 'string' ? recordName.trim() : '';
      const label = name || entity.metadata.title?.trim();
      if (!label) {
        continue;
      }

      const ref = stringifyEntityRef(entity);
      const team: SoftwareIndexTeam = { entity, ref, label };
      teams.set(ref, team);
      const sourceInstance = projection?.source?.sourceInstance;
      if (typeof sourceInstance === 'string') {
        teams.set(sourceKey({ sourceInstance, kind: 'team', id }), team);
      }
    }
  }

  return teams;
}
