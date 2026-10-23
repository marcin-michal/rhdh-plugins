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
import {
  Cell,
  CellText,
  Flex,
  Link,
  type ColumnConfig,
  type TableItem,
} from '@backstage/ui';
import { readEntity } from '../model/entities';
import { publicationState } from '../model/publicationState';
import { Timestamp } from '../components/shared/Timestamp';

export interface PortfolioTableRow extends TableItem {
  entity: Entity;
  name: string;
  href: string;
  type: string;
  description: string;
  teams: { ref: string; label: string; href: string }[];
  sourceStatus: string;
  updatedAt?: string;
}

function typeLabel(category?: string): string {
  switch (category) {
    case 'listing':
      return 'Product listing';
    case 'repository':
      return 'Repository';
    case 'team':
      return 'Team';
    case 'user':
      return 'User';
    default:
      return 'Unknown';
  }
}

function sourceTeamId(entity: Entity): string | undefined {
  const record = readEntity(entity).value?.projection.record;
  if (
    record &&
    'team_id' in record &&
    typeof record.team_id === 'string' &&
    record.team_id.trim()
  ) {
    return record.team_id.trim();
  }

  return undefined;
}

export function createPortfolioRows(
  entities: Entity[],
  teamLabels: ReadonlyMap<string, string>,
  getEntityHref: (entityOrRef: Entity | string) => string,
): PortfolioTableRow[] {
  return entities.map(entity => {
    const model = readEntity(entity).value;
    const teamId = sourceTeamId(entity);
    const teams = (entity.relations ?? [])
      .filter(relation => ['ownedBy', 'memberOf'].includes(relation.type))
      .map(relation => {
        const fallbackLabel =
          teamId ?? relation.targetRef.split('/').pop() ?? relation.targetRef;

        return {
          ref: relation.targetRef,
          label: teamLabels.get(relation.targetRef) ?? fallbackLabel,
          href: getEntityHref(relation.targetRef),
        };
      });
    const state = model ? publicationState(model) : 'unknown';

    return {
      id: entity.metadata.uid ?? stringifyEntityRef(entity),
      entity,
      name: model?.title ?? entity.metadata.title ?? entity.metadata.name,
      href: getEntityHref(entity),
      type: typeLabel(model?.category),
      description: model?.description ?? '',
      teams,
      sourceStatus: state === 'not-applicable' ? '—' : state.replace('-', ' '),
      updatedAt: model?.updatedAt,
    };
  });
}

export const portfolioColumns: ColumnConfig<PortfolioTableRow>[] = [
  {
    id: 'name',
    label: 'Name',
    width: '3fr',
    isSortable: true,
    isRowHeader: true,
    cell: row => <CellText title={row.name} href={row.href} />,
  },
  {
    id: 'type',
    label: 'Type',
    width: '1fr',
    isSortable: true,
    cell: row => <CellText title={row.type} />,
  },
  {
    id: 'description',
    label: 'Description',
    width: '2fr',
    cell: row => <CellText title={row.description || '—'} color="secondary" />,
  },
  {
    id: 'team',
    label: 'Team',
    width: '2fr',
    cell: row => {
      if (row.teams.length === 0) {
        return <CellText title="—" color="secondary" />;
      }
      return (
        <Cell>
          <Flex direction="column" gap="1">
            {row.teams.map(team => (
              <Link key={team.ref} href={team.href}>
                {team.label}
              </Link>
            ))}
          </Flex>
        </Cell>
      );
    },
  },
  {
    id: 'sourceStatus',
    label: 'Source status',
    width: '1fr',
    cell: row => <CellText title={row.sourceStatus} />,
  },
  {
    id: 'updatedAt',
    label: 'Last updated',
    width: '1fr',
    cell: row => (
      <Cell>
        <Timestamp value={row.updatedAt} />
      </Cell>
    ),
  },
];
