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
import { readEntity, sortEntities } from '../../model/entities';
import { Timestamp } from './Timestamp';

type RelatedEntityCategory = 'listing' | 'repository';

interface RelatedEntityTableRow extends TableItem {
  entity: Entity;
  name: string;
  href: string;
  description?: string;
  updatedAt?: string;
}

const tableCopy: Record<
  RelatedEntityCategory,
  {
    title: string;
    searchPlaceholder: string;
    noMatchesMessage: string;
    emptyMessage: string;
  }
> = {
  listing: {
    title: 'Product listings',
    searchPlaceholder: 'Search product listings',
    noMatchesMessage: 'No product listings match your search.',
    emptyMessage: 'No product listings are linked to this repository.',
  },
  repository: {
    title: 'Repositories',
    searchPlaceholder: 'Search repositories',
    noMatchesMessage: 'No repositories match your search.',
    emptyMessage: 'No repositories are linked to this product listing.',
  },
};

function sortRows(
  rows: RelatedEntityTableRow[],
  sort: SortDescriptor,
): RelatedEntityTableRow[] {
  if (sort.column !== 'name') {
    return rows;
  }

  const direction = sort.direction === 'descending' ? -1 : 1;

  return [...rows].sort(
    (first, second) => direction * sortEntities(first.entity, second.entity),
  );
}

function searchRows(
  rows: RelatedEntityTableRow[],
  search: string,
): RelatedEntityTableRow[] {
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

const relatedEntityColumns: ColumnConfig<RelatedEntityTableRow>[] = [
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

export function RelatedEntitiesTable({
  entities,
  loading,
  category,
  emptyMessage,
}: {
  entities: Entity[];
  loading: boolean;
  category: RelatedEntityCategory;
  emptyMessage?: string;
}) {
  const copy = tableCopy[category];
  const titleId =
    category === 'listing'
      ? 'repository-product-listings-title'
      : 'listing-repositories-title';
  const entityRoute = useRouteRef(entityRouteRef);
  const rows = useMemo(
    () =>
      entities.flatMap(entity => {
        const model = readEntity(entity).value;
        if (!model || model.category !== category) {
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
    [category, entities, entityRoute],
  );

  const { tableProps, search } = useTable({
    mode: 'complete',
    data: rows,
    initialSort: { column: 'name', direction: 'ascending' },
    sortFn: sortRows,
    searchFn: searchRows,
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
            ? copy.noMatchesMessage
            : emptyMessage ?? copy.emptyMessage}
        </Text>
      </Flex>
    </Box>
  );

  return (
    <Card aria-labelledby={titleId}>
      <CardBody>
        <Flex direction="column" gap="4">
          <Flex
            direction={{ initial: 'column', sm: 'row' }}
            align={{ initial: 'stretch', sm: 'end' }}
            justify="between"
            gap="3"
          >
            <Text as="h2" id={titleId} variant="title-small">
              {copy.title}
            </Text>
            <Box width="100%" style={{ maxWidth: '24rem' }}>
              <TextField
                label="Search by name"
                placeholder={copy.searchPlaceholder}
                value={search.value}
                onChange={search.onChange}
                size="small"
              />
            </Box>
          </Flex>
          <Table
            {...tableProps}
            columnConfig={relatedEntityColumns}
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
