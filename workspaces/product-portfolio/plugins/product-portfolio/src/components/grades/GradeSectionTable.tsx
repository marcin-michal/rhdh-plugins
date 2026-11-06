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

import { memo, useMemo, useState } from 'react';
import { stringifyEntityRef, type Entity } from '@backstage/catalog-model';
import { useRouteRef } from '@backstage/core-plugin-api';
import {
  entityRouteParams,
  entityRouteRef,
} from '@backstage/plugin-catalog-react';
import {
  Box,
  Button,
  Cell,
  CellText,
  Flex,
  Link,
  SearchField,
  Table,
  Tag,
  TagGroup,
  Text,
  type ColumnConfig,
  type TableItem,
  useTable,
} from '@backstage/ui';
import type { ImageOccurrence } from '../../model/portfolioChi';
import { readEntity } from '../../model/entities';
import { gradeCellStyle, gradeToneForId } from '../shared/gradeStyles';
import { Timestamp } from '../shared/Timestamp';
import { ScheduledDropCell } from './ScheduledDropCell';

export type GradeSectionId = 'a' | 'a-with-drop' | 'b' | 'c' | 'd' | 'e' | 'f';

export interface GradeSection {
  id: GradeSectionId;
  label: string;
  images: ImageOccurrence[];
}

export interface GradeImageRow extends TableItem {
  imageId: string;
  repository: Entity;
  repositoryName: string;
  catalogHref?: string;
  activeTags: readonly string[];
  architecture: string;
  lastPushedAt: string | null;
  futureDrops: ImageOccurrence['image']['futureDrops'];
}

interface RepositoryRowDetails {
  repositoryName: string;
  catalogHrefBase?: string;
}

const MAX_VISIBLE_TAGS = 3;

function repositoryRowDetails(repository: Entity): RepositoryRowDetails {
  const model = readEntity(repository).value;
  const record = model?.projection.record;
  const repositoryName =
    record &&
    'repository' in record &&
    typeof record.repository === 'string' &&
    record.repository
      ? record.repository
      : model?.path ??
        model?.title ??
        repository.metadata.title ??
        repository.metadata.name;
  let catalogHrefBase: string | undefined;

  if (model?.category === 'repository' && repositoryName) {
    const pathSegments = repositoryName.split('/').filter(Boolean);
    const [namespace, ...nameSegments] = pathSegments;
    const name = nameSegments.join('/');
    const repositoryId = model.projection.source.id;

    if (namespace && name && repositoryId) {
      const catalogPath = [namespace, ...nameSegments, repositoryId]
        .map(segment => encodeURIComponent(segment))
        .join('/');
      catalogHrefBase = `https://catalog.redhat.com/en/software/containers/${catalogPath}`;
    }
  }

  return { repositoryName, catalogHrefBase };
}

function catalogHrefForImage(
  catalogHrefBase: string | undefined,
  image: ImageOccurrence['image'],
): string | undefined {
  if (!catalogHrefBase) {
    return undefined;
  }

  const tag = image.selectedIn.find(Boolean) ?? image.activeTags.find(Boolean);
  if (!tag) {
    return catalogHrefBase;
  }

  const url = new URL(catalogHrefBase);
  url.searchParams.set('tag', tag);
  return url.toString();
}

function latestPushDate(image: ImageOccurrence['image']): string | null {
  return Object.values(image.pushDates).reduce<string | null>(
    (latest, pushDate) =>
      Number.isFinite(Date.parse(pushDate)) &&
      (!latest || Date.parse(pushDate) > Date.parse(latest))
        ? pushDate
        : latest,
    null,
  );
}

export function buildGradeImageRows(
  images: readonly ImageOccurrence[],
): GradeImageRow[] {
  const repositoryDetails = new Map<Entity, RepositoryRowDetails>();
  const rows = images
    .map(({ repository, image }): GradeImageRow => {
      let details = repositoryDetails.get(repository);
      if (!details) {
        details = repositoryRowDetails(repository);
        repositoryDetails.set(repository, details);
      }

      return {
        id: `image-${stringifyEntityRef(repository)}-${image.imageId}`,
        imageId: image.imageId,
        repository,
        ...details,
        catalogHref: catalogHrefForImage(details.catalogHrefBase, image),
        activeTags: image.activeTags,
        architecture: image.architecture,
        lastPushedAt: latestPushDate(image),
        futureDrops: image.futureDrops,
      };
    })
    .sort(
      (first, second) =>
        first.repositoryName.localeCompare(second.repositoryName) ||
        first.architecture.localeCompare(second.architecture) ||
        first.imageId.localeCompare(second.imageId),
    );

  return rows;
}

function searchGradeImageRows(
  rows: GradeImageRow[],
  search: string,
): GradeImageRow[] {
  const query = search.trim().toLocaleLowerCase('en-US');
  if (!query) {
    return rows;
  }

  return rows.filter(row =>
    row.repositoryName.toLocaleLowerCase('en-US').includes(query),
  );
}

function TagsCell({ row }: { row: GradeImageRow }) {
  const [showAll, setShowAll] = useState(false);
  const visibleTags = showAll
    ? row.activeTags
    : row.activeTags.slice(0, MAX_VISIBLE_TAGS);
  const hiddenTagCount = row.activeTags.length - visibleTags.length;

  if (!row.activeTags.length) {
    return (
      <Cell>
        <Text as="span" color="secondary">
          —
        </Text>
      </Cell>
    );
  }

  return (
    <Cell>
      <Flex direction="column" gap="1">
        <TagGroup aria-label={`Tags for ${row.repositoryName}`}>
          {visibleTags.map((tag, index) => (
            <Tag
              id={`${row.id}-tag-${index}`}
              key={`${tag}-${index}`}
              size="small"
            >
              {tag}
            </Tag>
          ))}
        </TagGroup>
        {row.activeTags.length > MAX_VISIBLE_TAGS && (
          <Button
            variant="tertiary"
            size="small"
            aria-expanded={showAll}
            onPress={() => setShowAll(value => !value)}
            style={{ alignSelf: 'flex-start', padding: 0 }}
          >
            {showAll ? 'Show fewer tags' : `+${hiddenTagCount} more`}
          </Button>
        )}
      </Flex>
    </Cell>
  );
}

export const GradeSectionTable = memo(function GradeSectionTable({
  section,
  expanded,
  onToggle,
}: {
  section: GradeSection;
  expanded: boolean;
  onToggle: (sectionId: GradeSectionId, expanded: boolean) => void;
}) {
  const entityRoute = useRouteRef(entityRouteRef);
  const rows = useMemo(
    () => buildGradeImageRows(section.images),
    [section.images],
  );
  const columnConfig = useMemo<ColumnConfig<GradeImageRow>[]>(
    () => [
      {
        id: 'name',
        label: 'Name',
        width: '2fr',
        isRowHeader: true,
        cell: row => (
          <Cell>
            <Flex align="center" gap="2">
              <Link href={entityRoute(entityRouteParams(row.repository))}>
                {row.repositoryName}
              </Link>
              {row.catalogHref && (
                <Link
                  href={row.catalogHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open ${row.repositoryName} in Red Hat Catalog`}
                  title="Open in Red Hat Catalog"
                >
                  <Text as="span" variant="body-small" aria-hidden="true">
                    ↗
                  </Text>
                </Link>
              )}
            </Flex>
          </Cell>
        ),
      },
      {
        id: 'tags',
        label: 'Tags',
        width: '2fr',
        cell: row => <TagsCell row={row} />,
      },
      {
        id: 'architecture',
        label: 'Architecture',
        width: '0.9fr',
        cell: row => <CellText title={row.architecture} />,
      },
      {
        id: 'lastPushed',
        label: 'Last pushed',
        width: '1.3fr',
        cell: row => (
          <Cell>
            <Timestamp value={row.lastPushedAt} />
          </Cell>
        ),
      },
      {
        id: 'nextScheduledDrop',
        label: 'Next scheduled drop',
        width: '1.5fr',
        cell: row => (
          <Cell style={{ verticalAlign: 'middle' }}>
            <ScheduledDropCell drops={row.futureDrops} />
          </Cell>
        ),
      },
    ],
    [entityRoute],
  );
  const { tableProps, search } = useTable({
    mode: 'complete',
    data: rows,
    searchFn: searchGradeImageRows,
    paginationOptions: {
      type: 'page',
      pageSize: 5,
      pageSizeOptions: [5, 10, 20],
    },
  });
  const tableId = `grade-images-${section.id}`;

  return (
    <Box as="section">
      <Button
        variant="tertiary"
        aria-expanded={expanded}
        aria-controls={expanded ? tableId : undefined}
        onPress={() => onToggle(section.id, !expanded)}
        style={{
          ...gradeCellStyle(gradeToneForId(section.id)),
          border: 0,
          borderRadius: 4,
          cursor: 'pointer',
          font: 'inherit',
          padding: '0.75rem 1rem',
          textAlign: 'left',
          width: '100%',
        }}
      >
        <Flex
          align="center"
          justify="between"
          style={{ width: '100%', color: 'inherit' }}
        >
          <Flex align="center" gap="2">
            <Text
              as="span"
              variant="body-medium"
              aria-hidden="true"
              style={{ color: 'inherit' }}
            >
              {expanded ? '⌄' : '›'}
            </Text>
            <Text as="span" variant="body-medium" style={{ color: 'inherit' }}>
              Grade {section.label}
            </Text>
          </Flex>
          <Text as="span" variant="body-medium" style={{ color: 'inherit' }}>
            {section.images.length.toLocaleString()} image
            {section.images.length === 1 ? '' : 's'}
          </Text>
        </Flex>
      </Button>
      {expanded && (
        <Box id={tableId}>
          <Flex direction="column" gap="2">
            <SearchField
              aria-label={`Search grade ${section.label} images by repository name`}
              placeholder="Search by repository name"
              size="small"
              value={search.value}
              onChange={search.onChange}
            />
            <Table {...tableProps} columnConfig={columnConfig} />
          </Flex>
        </Box>
      )}
    </Box>
  );
});
