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
import { PYXIS_RELATIONS } from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import { readEntity, sourceKey } from '../model/entities';
import {
  publicationState,
  publicationStateLabel,
} from '../model/publicationState';
import { Timestamp } from '../components/shared/Timestamp';
import type { PortfolioCategory } from './filterState';

export interface PortfolioTeam {
  entity: Entity;
  ref: string;
  label: string;
}

interface PortfolioTeamLink {
  ref: string;
  label: string;
  href: string;
}

export interface PortfolioTableRow extends TableItem {
  entity: Entity;
  name: string;
  href: string;
  description: string;
  repositoryPath?: string;
  teams: PortfolioTeamLink[];
  repositoryCount?: number;
  memberCount?: number;
  publishedState: string;
  updatedAt?: string;
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
  teamDirectory: ReadonlyMap<string, PortfolioTeam>,
  getEntityHref: (entity: Entity) => string,
): PortfolioTableRow[] {
  return entities.map(entity => {
    const model = readEntity(entity).value;
    const teamKeys = (entity.relations ?? [])
      .filter(relation => ['ownedBy', 'memberOf'].includes(relation.type))
      .map(relation => relation.targetRef);
    const teamId = sourceTeamId(entity);
    if (model && teamId) {
      teamKeys.push(
        sourceKey({
          sourceInstance: model.projection.source.sourceInstance,
          kind: 'team',
          id: teamId,
        }),
      );
    }

    const teamsByRef = new Map<string, PortfolioTeam>();
    for (const key of new Set(teamKeys)) {
      const team = teamDirectory.get(key);
      if (team) {
        teamsByRef.set(team.ref, team);
      }
    }

    const repositoryCount =
      model?.category === 'listing'
        ? new Set(
            (entity.relations ?? [])
              .filter(
                relation => relation.type === PYXIS_RELATIONS.hasRepository,
              )
              .map(relation => relation.targetRef),
          ).size
        : undefined;

    return {
      id: entity.metadata.uid ?? stringifyEntityRef(entity),
      entity,
      name: model?.title ?? entity.metadata.title ?? entity.metadata.name,
      href: getEntityHref(entity),
      description: model?.description ?? '',
      repositoryPath: model?.path,
      teams: [...teamsByRef.values()].map(team => ({
        ref: team.ref,
        label: team.label,
        href: getEntityHref(team.entity),
      })),
      repositoryCount,
      memberCount:
        model?.category === 'team'
          ? model.projection.roster?.members.length
          : undefined,
      publishedState: model
        ? publicationStateLabel(publicationState(model))
        : 'Unknown',
      updatedAt: model?.updatedAt,
    };
  });
}

const nameColumn: ColumnConfig<PortfolioTableRow> = {
  id: 'name',
  label: 'Name',
  width: '2fr',
  isSortable: true,
  isRowHeader: true,
  cell: row => <CellText title={row.name} href={row.href} />,
};

const shortDescriptionColumn: ColumnConfig<PortfolioTableRow> = {
  id: 'description',
  label: 'Short description',
  width: '3fr',
  cell: row => <CellText title={row.description || '—'} color="secondary" />,
};

const teamColumn: ColumnConfig<PortfolioTableRow> = {
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
};

const repositoryCountColumn: ColumnConfig<PortfolioTableRow> = {
  id: 'repositoryCount',
  label: 'Repositories',
  width: '1fr',
  cell: row => (
    <Cell style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
      {row.repositoryCount?.toLocaleString() ?? '—'}
    </Cell>
  ),
};

const publishedStateColumn: ColumnConfig<PortfolioTableRow> = {
  id: 'publishedState',
  label: 'Published state',
  width: '1fr',
  cell: row => <CellText title={row.publishedState} />,
};

const lastUpdatedColumn: ColumnConfig<PortfolioTableRow> = {
  id: 'updatedAt',
  label: 'Last updated',
  width: '1fr',
  cell: row => (
    <Cell>
      <Timestamp value={row.updatedAt} />
    </Cell>
  ),
};

const repositoryPathColumn: ColumnConfig<PortfolioTableRow> = {
  id: 'repositoryPath',
  label: 'Registry / repository',
  width: '3fr',
  cell: row => <CellText title={row.repositoryPath || '—'} />,
};

const memberCountColumn: ColumnConfig<PortfolioTableRow> = {
  id: 'memberCount',
  label: 'Members',
  width: '0.25fr',
  cell: row => (
    <Cell style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
      {row.memberCount?.toLocaleString() ?? '—'}
    </Cell>
  ),
};

export const portfolioColumnsByKind: Record<
  PortfolioCategory,
  ColumnConfig<PortfolioTableRow>[]
> = {
  listing: [
    nameColumn,
    shortDescriptionColumn,
    teamColumn,
    repositoryCountColumn,
    publishedStateColumn,
    lastUpdatedColumn,
  ],
  repository: [
    nameColumn,
    repositoryPathColumn,
    teamColumn,
    publishedStateColumn,
    lastUpdatedColumn,
  ],
  team: [nameColumn, memberCountColumn, lastUpdatedColumn],
};
