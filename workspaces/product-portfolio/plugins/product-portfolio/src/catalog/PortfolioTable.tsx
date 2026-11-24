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

import { useEffect, useMemo, useState } from 'react';
import { stringifyEntityRef } from '@backstage/catalog-model';
import { useApi, useRouteRef } from '@backstage/core-plugin-api';
import {
  catalogApiRef,
  entityRouteParams,
  entityRouteRef,
  type CatalogApi,
} from '@backstage/plugin-catalog-react';
import {
  Box,
  Button,
  Card,
  CardBody,
  Flex,
  Table,
  Text,
  useTable,
} from '@backstage/ui';
import { readEntity } from '../model/entities';
import { QualityNotice } from '../components/shared/QualityNotice';
import {
  createPortfolioRows,
  portfolioColumnsByKind,
  type PortfolioTeam,
  type PortfolioTableItem,
} from './columns';
import type { PortfolioCategory } from './filterState';
import {
  fetchPortfolioTeamDirectory,
  portfolioEntityFilter,
  PORTFOLIO_ENTITY_FIELDS,
  PORTFOLIO_SEARCH_FIELDS,
} from './portfolioCatalogApi';

interface PortfolioTableProps {
  kind: PortfolioCategory;
  search: string;
  title: string;
}

type TeamDirectory = ReadonlyMap<string, PortfolioTeam>;
const emptyTeamDirectory: TeamDirectory = new Map();

export function PortfolioTable(props: PortfolioTableProps) {
  const catalogApi = useApi(catalogApiRef);
  const needsTeamDirectory = props.kind !== 'team';
  const [loaded, setLoaded] = useState<{
    catalogApi: CatalogApi;
    directory: TeamDirectory | 'error';
  }>();
  const teamDirectory =
    loaded?.catalogApi === catalogApi ? loaded.directory : undefined;

  const loadTeamDirectory = useMemo(() => {
    let directory: Promise<TeamDirectory | 'error'> | undefined;
    return () => {
      directory ??= fetchPortfolioTeamDirectory(catalogApi).catch(() => {
        directory = undefined;
        return 'error' as const;
      });

      return directory;
    };
  }, [catalogApi]);

  useEffect(() => {
    if (!needsTeamDirectory || teamDirectory !== undefined) {
      return undefined;
    }

    let active = true;
    loadTeamDirectory().then(result => {
      if (active) {
        setLoaded({ catalogApi, directory: result });
      }
    });
    return () => {
      active = false;
    };
  }, [catalogApi, loadTeamDirectory, needsTeamDirectory, teamDirectory]);

  return (
    <PortfolioResults
      key={props.kind}
      {...props}
      catalogApi={catalogApi}
      teamDirectory={needsTeamDirectory ? teamDirectory : emptyTeamDirectory}
      retryTeams={() => setLoaded(undefined)}
    />
  );
}

function PortfolioResults({
  kind,
  search,
  title,
  catalogApi,
  teamDirectory,
  retryTeams,
}: PortfolioTableProps & {
  catalogApi: CatalogApi;
  teamDirectory: TeamDirectory | 'error' | undefined;
  retryTeams: () => void;
}) {
  const entityRoute = useRouteRef(entityRouteRef);
  const { tableProps, reload } = useTable<PortfolioTableItem>({
    mode: 'offset',
    search,
    initialSort: { column: 'name', direction: 'ascending' },
    getData: async ({ offset, pageSize, sort, search: searchTerm }) => {
      const term = searchTerm.trim();
      const response = await catalogApi.queryEntities({
        filter: portfolioEntityFilter(kind),
        limit: pageSize,
        offset,
        orderFields: {
          field: 'metadata.title',
          order: sort?.direction === 'descending' ? 'desc' : 'asc',
        },
        fields: PORTFOLIO_ENTITY_FIELDS,
        fullTextFilter: term
          ? { term, fields: PORTFOLIO_SEARCH_FIELDS }
          : undefined,
      });

      return {
        data: response.items.map(entity => ({
          id: entity.metadata.uid ?? stringifyEntityRef(entity),
          entity,
        })),
        totalCount: response.totalItems,
      };
    },
    paginationOptions: {
      pageSize: 20,
      pageSizeOptions: [20, 50, 100],
    },
  });

  const rows = useMemo(
    () =>
      tableProps.data &&
      createPortfolioRows(
        tableProps.data,
        teamDirectory === 'error' ? emptyTeamDirectory : teamDirectory,
        entity => entityRoute(entityRouteParams(entity)),
      ),
    [tableProps.data, teamDirectory, entityRoute],
  );
  const malformedCount = tableProps.isStale
    ? 0
    : (tableProps.data ?? []).filter(row => readEntity(row.entity).error)
        .length;

  const emptyState = (
    <Box p="8" role="status">
      <Flex align="center" justify="center">
        <Text as="p" variant="body-medium" color="secondary">
          No matching entries. Adjust the search or choose another kind.
        </Text>
      </Flex>
    </Box>
  );

  if (tableProps.error) {
    return (
      <Flex direction="column" gap="2">
        <QualityNotice
          error
          message="Product portfolio catalog data could not be loaded."
        />
        <Button onPress={reload}>Retry</Button>
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="4">
      {teamDirectory === 'error' && (
        <Flex direction="column" gap="2">
          <QualityNotice error message="Team names could not be loaded." />
          <Button onPress={retryTeams}>Retry team names</Button>
        </Flex>
      )}
      {malformedCount > 0 && (
        <QualityNotice
          error
          message={`${malformedCount} catalog ${
            malformedCount === 1 ? 'entity does' : 'entities do'
          } not match the managed product portfolio schema on this page.`}
        />
      )}
      <Card aria-labelledby="portfolio-results-title">
        <CardBody>
          <Flex direction="column" gap="4">
            <Text as="h2" id="portfolio-results-title" variant="title-small">
              {title}
            </Text>
            <Table
              {...tableProps}
              data={rows}
              columnConfig={portfolioColumnsByKind[kind]}
              emptyState={emptyState}
            />
          </Flex>
        </CardBody>
      </Card>
    </Flex>
  );
}
