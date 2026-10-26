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
import { useRouteRef } from '@backstage/core-plugin-api';
import {
  entityRouteParams,
  entityRouteRef,
} from '@backstage/plugin-catalog-react';
import {
  Button,
  Cell,
  CellText,
  Table,
  Text,
  type ColumnConfig,
  type TableItem,
  useTable,
} from '@backstage/ui';
import type { RelatedState } from '../../hooks/useRelatedEntities';
import { readEntity, sourceKey } from '../../model/entities';
import { DetailCard } from '../shared/DetailCard';
import { QualityNotice } from '../shared/QualityNotice';
import { Timestamp } from '../shared/Timestamp';

interface MemberRow extends TableItem {
  name: string;
  role: string;
  addedDate?: string;
  href?: string;
}

const memberColumns: ColumnConfig<MemberRow>[] = [
  {
    id: 'name',
    label: 'Name',
    width: '2fr',
    isRowHeader: true,
    cell: row => <CellText title={row.name} />,
  },
  {
    id: 'role',
    label: 'Role',
    width: '1fr',
    cell: row => <CellText title={row.role} />,
  },
  {
    id: 'added',
    label: 'Added',
    width: '1.5fr',
    cell: row => (
      <Cell>
        <Timestamp value={row.addedDate} />
      </Cell>
    ),
  },
];

export function TeamMembersTable({
  team,
  state,
}: {
  team: Entity;
  state: RelatedState;
}) {
  const entityRoute = useRouteRef(entityRouteRef);
  const teamModel = readEntity(team).value;
  const roster =
    teamModel?.category === 'team' ? teamModel.projection.roster : undefined;
  const users = state.entities.filter(
    user => readEntity(user).value?.category === 'user',
  );
  const usersBySourceKey = new Map(
    users.flatMap(user => {
      const source = readEntity(user).value?.projection.source;
      return source?.kind === 'user' ? [[sourceKey(source), user]] : [];
    }),
  );
  const rosterMembers = roster?.members ?? [];
  const rows: MemberRow[] = rosterMembers.length
    ? rosterMembers.map(member => {
        const user = usersBySourceKey.get(sourceKey(member.user));
        return {
          id: sourceKey(member.user),
          name: user?.metadata.title ?? user?.metadata.name ?? member.user.id,
          role: member.role ?? '—',
          addedDate: member.addedDate,
          href: user ? entityRoute(entityRouteParams(user)) : undefined,
        };
      })
    : users.map(user => ({
        id: stringifyEntityRef(user),
        name: user.metadata.title ?? user.metadata.name,
        role: '—',
        href: entityRoute(entityRouteParams(user)),
      }));
  const { tableProps } = useTable({
    mode: 'complete',
    data: rows,
    paginationOptions: {
      type: 'page',
      pageSize: 20,
      pageSizeOptions: [20, 50, 100],
    },
  });

  return (
    <DetailCard title="Members">
      {state.error && (
        <>
          <QualityNotice error message={state.error} />
          <Button onPress={state.retry}>Retry</Button>
        </>
      )}
      {state.partial && (
        <QualityNotice message="Some team members are not available in the catalog." />
      )}
      {roster && roster.completeness !== 'complete' && (
        <QualityNotice message="The Pyxis team roster is incomplete." />
      )}
      <Table
        {...tableProps}
        columnConfig={memberColumns}
        rowConfig={{ getHref: row => row.href }}
        loading={state.loading}
        emptyState={
          <Text as="p" color="secondary">
            No members are listed for this team.
          </Text>
        }
      />
    </DetailCard>
  );
}
