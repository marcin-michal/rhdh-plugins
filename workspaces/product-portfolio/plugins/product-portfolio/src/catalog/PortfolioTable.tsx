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
import type { Entity } from '@backstage/catalog-model';
import { useRouteRef } from '@backstage/core-plugin-api';
import {
  entityRouteParams,
  entityRouteRef,
} from '@backstage/plugin-catalog-react';
import {
  Box,
  Card,
  CardBody,
  Flex,
  Table,
  Text,
  type SortDescriptor,
  useTable,
} from '@backstage/ui';
import { sortEntities } from '../model/entities';
import {
  createPortfolioRows,
  portfolioColumnsByKind,
  type PortfolioTeam,
  type PortfolioTableRow,
} from './columns';
import type { PortfolioCategory } from './filterState';

interface PortfolioTableProps {
  kind: PortfolioCategory;
  entities: Entity[];
  teamDirectory: ReadonlyMap<string, PortfolioTeam>;
  title: string;
  loading: boolean;
}

function sortPortfolioRows(
  rows: PortfolioTableRow[],
  sort: SortDescriptor,
): PortfolioTableRow[] {
  if (sort.column !== 'name') {
    return rows;
  }

  const direction = sort.direction === 'descending' ? -1 : 1;
  return [...rows].sort((first, second) => {
    return direction * sortEntities(first.entity, second.entity);
  });
}

export function PortfolioTable({
  kind,
  entities,
  teamDirectory,
  title,
  loading,
}: PortfolioTableProps) {
  const entityRoute = useRouteRef(entityRouteRef);
  const rows = useMemo(
    () =>
      createPortfolioRows(entities, teamDirectory, entity =>
        entityRoute(entityRouteParams(entity)),
      ),
    [entities, entityRoute, teamDirectory],
  );
  const { tableProps } = useTable({
    mode: 'complete',
    data: rows,
    initialSort: { column: 'name', direction: 'ascending' },
    sortFn: sortPortfolioRows,
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
          No matching entries. Adjust the search or choose another kind.
        </Text>
      </Flex>
    </Box>
  );

  return (
    <Card aria-labelledby="portfolio-results-title">
      <CardBody>
        <Flex direction="column" gap="4">
          <Text as="h2" id="portfolio-results-title" variant="title-small">
            {title}
          </Text>
          <Table
            {...tableProps}
            columnConfig={portfolioColumnsByKind[kind]}
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
