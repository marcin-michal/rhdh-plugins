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

import { useState } from 'react';
import { stringifyEntityRef, type Entity } from '@backstage/catalog-model';
import { useApi, useRouteRef } from '@backstage/core-plugin-api';
import {
  catalogApiRef,
  entityRouteParams,
  entityRouteRef,
} from '@backstage/plugin-catalog-react';
import {
  Box,
  Button,
  Card,
  CardBody,
  Cell,
  CellText,
  Flex,
  Table,
  Text,
  TextField,
  type ColumnConfig,
  type TableItem,
  useTable,
} from '@backstage/ui';
import {
  PYXIS_ANNOTATIONS,
  PYXIS_ENTITY_TYPES,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import {
  portfolioEntityFilter,
  PORTFOLIO_ENTITY_FIELDS,
} from '../../catalog/portfolioCatalogApi';
import { relatedEntityRefs } from '../../hooks/useRelatedEntities';
import { readEntity } from '../../model/entities';
import { QualityNotice } from './QualityNotice';
import { Timestamp } from './Timestamp';

type RelatedEntityCategory = 'listing' | 'repository';
const relatedEntityFields = PORTFOLIO_ENTITY_FIELDS.filter(
  field => field !== 'relations',
);

interface RelatedEntityTableRow extends TableItem {
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
    emptyMessage: 'No linked product listings are available in the catalog.',
  },
  repository: {
    title: 'Repositories',
    searchPlaceholder: 'Search repositories',
    noMatchesMessage: 'No repositories match your search.',
    emptyMessage: 'No linked repositories are available in the catalog.',
  },
};

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

interface RelatedEntitiesTableProps {
  source: Entity;
  inverseRelation: string;
  category: RelatedEntityCategory;
  emptyMessage?: string;
  availability?: { relation: string; message: string };
}

export function RelatedEntitiesTable({
  source,
  availability,
  ...props
}: RelatedEntitiesTableProps) {
  const sourceRef = stringifyEntityRef(source);
  const expectedLinks = availability
    ? new Set(relatedEntityRefs([source], availability.relation)).size
    : 0;

  return (
    <RelatedEntitiesResults
      key={`${sourceRef}:${props.category}:${props.inverseRelation}:${expectedLinks}`}
      sourceRef={sourceRef}
      expectedLinks={expectedLinks}
      unavailableMessage={availability?.message}
      {...props}
    />
  );
}

function RelatedEntitiesResults({
  sourceRef,
  expectedLinks,
  inverseRelation,
  category,
  emptyMessage,
  unavailableMessage,
}: Omit<RelatedEntitiesTableProps, 'source' | 'availability'> & {
  sourceRef: string;
  expectedLinks: number;
  unavailableMessage?: string;
}) {
  const copy = tableCopy[category];
  const titleId =
    category === 'listing'
      ? 'repository-product-listings-title'
      : 'listing-repositories-title';
  const entityRoute = useRouteRef(entityRouteRef);
  const catalogApi = useApi(catalogApiRef);
  const [partial, setPartial] = useState(false);

  const { tableProps, search, reload } = useTable<RelatedEntityTableRow>({
    mode: 'offset',
    initialSort: { column: 'name', direction: 'ascending' },
    getData: async ({ offset, pageSize, sort, search: searchTerm, signal }) => {
      const term = searchTerm.trim();
      const page = await catalogApi.queryEntities({
        filter: {
          ...portfolioEntityFilter(category),
          kind: 'Resource',
          'spec.type': PYXIS_ENTITY_TYPES[category],
          [`metadata.annotations.${PYXIS_ANNOTATIONS.projectionVersion}`]: '1',
          [`relations.${inverseRelation}`]: sourceRef,
        },
        offset,
        limit: pageSize,
        fields: relatedEntityFields,
        orderFields: {
          field: 'metadata.title',
          order: sort?.direction === 'descending' ? 'desc' : 'asc',
        },
        fullTextFilter: term
          ? { term, fields: ['metadata.title', 'metadata.name'] }
          : undefined,
      });

      if (expectedLinks && offset === 0 && !term && !signal.aborted) {
        setPartial(page.totalItems < expectedLinks);
      }

      const data = page.items.flatMap(entity => {
        const model = readEntity(entity).value;
        if (!model || model.category !== category) {
          return [];
        }

        return [
          {
            id: entity.metadata.uid ?? stringifyEntityRef(entity),
            name: model.title,
            href: entityRoute(entityRouteParams(entity)),
            description: model.description,
            updatedAt: model.updatedAt,
          },
        ];
      });

      return { data, totalCount: page.totalItems };
    },
    paginationOptions: {
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
    <Flex direction="column" gap="4">
      {partial && unavailableMessage && (
        <QualityNotice message={unavailableMessage} />
      )}
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
            {tableProps.error ? (
              <Flex direction="column" gap="2">
                <QualityNotice
                  error
                  message="Related catalog data could not be loaded."
                />
                <Button onPress={reload}>Retry</Button>
              </Flex>
            ) : (
              <Table
                {...tableProps}
                columnConfig={relatedEntityColumns}
                rowConfig={{ getHref: row => row.href }}
                emptyState={emptyState}
              />
            )}
          </Flex>
        </CardBody>
      </Card>
    </Flex>
  );
}
