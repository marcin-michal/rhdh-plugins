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

import { useMemo } from 'react';
import { stringifyEntityRef, type Entity } from '@backstage/catalog-model';
import { useRouteRef } from '@backstage/core-plugin-api';
import {
  entityRouteParams,
  entityRouteRef,
} from '@backstage/plugin-catalog-react';
import {
  Box,
  Card,
  CardBody,
  Cell,
  CellText,
  Flex,
  Table,
  Text,
  TextField,
  type ColumnConfig,
  type SortDescriptor,
  type TableItem,
  useTable,
} from '@backstage/ui';
import { readEntity, sortEntities } from '../model/entities';
import { Timestamp } from './shared/Timestamp';

interface RepositoryTableRow extends TableItem {
  entity: Entity;
  name: string;
  href: string;
  description?: string;
  updatedAt?: string;
}

function sortRepositoryRows(
  rows: RepositoryTableRow[],
  sort: SortDescriptor,
): RepositoryTableRow[] {
  if (sort.column !== 'name') {
    return rows;
  }

  const direction = sort.direction === 'descending' ? -1 : 1;

  return [...rows].sort(
    (first, second) => direction * sortEntities(first.entity, second.entity),
  );
}

function searchRepositoryRows(
  rows: RepositoryTableRow[],
  search: string,
): RepositoryTableRow[] {
  const query = search.trim().toLocaleLowerCase();
  if (!query) {
    return rows;
  }

  return rows.filter(
    row =>
      row.name.toLocaleLowerCase().includes(query) ||
      row.entity.metadata.name.toLocaleLowerCase().includes(query),
  );
}

const repositoryColumns: ColumnConfig<RepositoryTableRow>[] = [
  {
    id: 'name',
    label: 'Name',
    width: '2fr',
    isSortable: true,
    isRowHeader: true,
    cell: row => <CellText title={row.name} />,
  },
  {
    id: 'description',
    label: 'Description',
    width: '4fr',
    cell: row => <CellText title={row.description || '—'} color="secondary" />,
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

export function ListingRepositoriesTable({
  entities,
  loading,
}: {
  entities: Entity[];
  loading: boolean;
}) {
  const entityRoute = useRouteRef(entityRouteRef);
  const rows = useMemo(
    () =>
      entities.flatMap(entity => {
        const model = readEntity(entity).value;
        if (!model || model.category !== 'repository') {
          return [];
        }

        return [
          {
            id: entity.metadata.uid ?? stringifyEntityRef(entity),
            entity,
            name: model.title,
            href: entityRoute(entityRouteParams(entity)),
            description: model.description,
            updatedAt: model.updatedAt,
          },
        ];
      }),
    [entities, entityRoute],
  );

  const { tableProps, search } = useTable({
    mode: 'complete',
    data: rows,
    initialSort: { column: 'name', direction: 'ascending' },
    sortFn: sortRepositoryRows,
    searchFn: searchRepositoryRows,
    paginationOptions: {
      type: 'page',
      pageSize: 20,
      pageSizeOptions: [20, 50, 100],
    },
  });

  const emptyState = (
    <Box p="8" role="status">
      <Flex align="center" justify="center">
        <Text as="p" variant="body-medium" color="secondary">
          {search.value.trim()
            ? 'No repositories match your search.'
            : 'No repositories are linked to this product listing.'}
        </Text>
      </Flex>
    </Box>
  );

  return (
    <Card aria-labelledby="listing-repositories-title">
      <CardBody>
        <Flex direction="column" gap="4">
          <Flex
            direction={{ initial: 'column', sm: 'row' }}
            align={{ initial: 'stretch', sm: 'end' }}
            justify="between"
            gap="3"
          >
            <Text as="h2" id="listing-repositories-title" variant="title-small">
              Repositories
            </Text>
            <Box width="100%" style={{ maxWidth: '24rem' }}>
              <TextField
                label="Search by name"
                placeholder="Search repositories"
                value={search.value}
                onChange={search.onChange}
                size="small"
              />
            </Box>
          </Flex>
          <Table
            {...tableProps}
            columnConfig={repositoryColumns}
            rowConfig={{ getHref: row => row.href }}
            data={
              loading && tableProps.data?.length === 0
                ? undefined
                : tableProps.data
            }
            loading={loading}
            emptyState={emptyState}
          />
        </Flex>
      </CardBody>
    </Card>
  );
}
