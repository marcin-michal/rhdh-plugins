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

import type { ReactNode } from 'react';
import { stringifyEntityRef, type Entity } from '@backstage/catalog-model';
import { useRouteRef } from '@backstage/core-plugin-api';
import {
  entityRouteParams,
  entityRouteRef,
  useEntity,
} from '@backstage/plugin-catalog-react';
import {
  Cell,
  CellText,
  Flex,
  Link,
  Table,
  Tag,
  TagGroup,
  Text,
  type ColumnConfig,
  type TableItem,
  useTable,
} from '@backstage/ui';
import { PYXIS_RELATIONS } from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import { useLocation } from 'react-router-dom';
import {
  useRelatedEntities,
  type RelatedState,
} from '../../hooks/useRelatedEntities';
import { useOwnedPortfolioRepositories } from '../../hooks/useOwnedPortfolioEntities';
import { readEntity } from '../../model/entities';
import {
  aggregatePortfolioChi,
  type ImageOccurrence,
  type PortfolioChiBucket,
} from '../../model/portfolioChi';
import { AsyncState } from '../shared/AsyncState';
import { ChiObservationMetadata } from '../shared/ChiObservationMetadata';
import { DetailCard } from '../shared/DetailCard';
import { Timestamp } from '../shared/Timestamp';
import { QualityNotice } from '../shared/QualityNotice';
import { gradeCellStyle, gradeToneForId } from '../shared/gradeStyles';

type GradeSectionId = 'a' | 'a-with-drop' | 'b' | 'c' | 'd' | 'e' | 'f';

interface GradeSection {
  id: GradeSectionId;
  label: string;
  images: ImageOccurrence[];
}

interface GradeRow extends TableItem {
  kind: 'grade';
  sectionId: GradeSectionId;
  label: string;
  count: number;
  expanded: boolean;
}

interface ImageRow extends TableItem {
  kind: 'image';
  imageId: string;
  repositoryName: string;
  repositoryHref: string;
  catalogHref?: string;
  activeTags: readonly string[];
  architecture: string;
  lastPushedAt: string | null;
}

type GradeTableRow = GradeRow | ImageRow;

const gradeSectionLabels: Array<{
  id: GradeSectionId;
  label: string;
}> = [
  { id: 'a', label: 'A' },
  { id: 'a-with-drop', label: 'A with scheduled drop' },
  { id: 'b', label: 'B' },
  { id: 'c', label: 'C' },
  { id: 'd', label: 'D' },
  { id: 'e', label: 'E' },
  { id: 'f', label: 'F' },
];

function sectionsFromBuckets(buckets: PortfolioChiBucket[]): GradeSection[] {
  const imagesBySection = new Map<GradeSectionId, ImageOccurrence[]>();

  for (const bucket of buckets) {
    if (bucket.grade === 'Unknown') {
      continue;
    }

    for (const occurrence of bucket.images) {
      const sectionId: GradeSectionId =
        bucket.grade === 'A' && occurrence.image.futureDrops.length > 0
          ? 'a-with-drop'
          : (bucket.grade.toLocaleLowerCase('en-US') as GradeSectionId);
      const images = imagesBySection.get(sectionId) ?? [];
      images.push(occurrence);
      imagesBySection.set(sectionId, images);
    }
  }

  return gradeSectionLabels.flatMap(({ id, label }) => {
    const images = imagesBySection.get(id) ?? [];
    return images.length ? [{ id, label, images }] : [];
  });
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

function repositoryRowDetails(
  repository: Entity,
  image: ImageOccurrence['image'],
): Pick<ImageRow, 'repositoryName' | 'catalogHref'> {
  const model = readEntity(repository).value;
  const record = model?.projection.record;
  const repositoryName =
    record &&
    'repository' in record &&
    typeof record.repository === 'string' &&
    record.repository
      ? record.repository
      : undefined;
  let catalogHref: string | undefined;

  if (model?.category === 'repository' && repositoryName) {
    const pathSegments = repositoryName.split('/').filter(Boolean);
    const [namespace, ...nameSegments] = pathSegments;
    const name = nameSegments.join('/');
    const repositoryId = model.projection.source.id;

    if (namespace && name && repositoryId) {
      const catalogPath = [namespace, ...nameSegments, repositoryId]
        .map(segment => encodeURIComponent(segment))
        .join('/');
      const url = new URL(
        `https://catalog.redhat.com/en/software/containers/${catalogPath}`,
      );

      const tag =
        image.selectedIn.find(Boolean) ?? image.activeTags.find(Boolean);
      if (tag) {
        url.searchParams.set('tag', tag);
      }

      catalogHref = url.toString();
    }
  }

  return {
    repositoryName:
      repositoryName ??
      model?.path ??
      model?.title ??
      repository.metadata.title ??
      repository.metadata.name,
    catalogHref,
  };
}

function ExternalLinkIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.5 2.5h4v4M13.25 2.75 7.5 8.5" />
      <path d="M7 4H4a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 4 13h6a1.5 1.5 0 0 0 1.5-1.5v-3" />
    </svg>
  );
}

function gradeRows(
  sections: GradeSection[],
  expandedGrade: string | null,
  repositoryHref: (repository: Entity) => string,
): GradeTableRow[] {
  return sections.flatMap(section => {
    const isExpanded = expandedGrade === section.id;
    const groupRow: GradeRow = {
      id: `grade-${section.id}`,
      kind: 'grade',
      sectionId: section.id,
      label: section.label,
      count: section.images.length,
      expanded: isExpanded,
    };

    if (!isExpanded) {
      return [groupRow];
    }

    const images = section.images
      .map(({ repository, image }): ImageRow => {
        const repositoryDetails = repositoryRowDetails(repository, image);
        return {
          id: `image-${stringifyEntityRef(repository)}-${image.imageId}`,
          kind: 'image',
          imageId: image.imageId,
          ...repositoryDetails,
          repositoryHref: repositoryHref(repository),
          activeTags: image.activeTags,
          architecture: image.architecture,
          lastPushedAt: latestPushDate(image),
        };
      })
      .sort(
        (first, second) =>
          first.repositoryName.localeCompare(second.repositoryName) ||
          first.architecture.localeCompare(second.architecture) ||
          first.imageId.localeCompare(second.imageId),
      );

    return [groupRow, ...images];
  });
}

function gradeHref(
  pathname: string,
  search: string,
  hash: string,
  grade: GradeSectionId | undefined,
) {
  const params = new URLSearchParams(search);
  if (grade) {
    params.set('grade', grade);
  } else {
    params.delete('grade');
  }

  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ''}${hash}`;
}

function gradeCell(row: GradeRow, children: ReactNode) {
  return (
    <Cell style={gradeCellStyle(gradeToneForId(row.sectionId))}>
      {children}
    </Cell>
  );
}

const gradeColumns: ColumnConfig<GradeTableRow>[] = [
  {
    id: 'name',
    label: 'Name',
    width: '2fr',
    isRowHeader: true,
    cell: row => {
      if (row.kind === 'grade') {
        return gradeCell(
          row,
          <Flex align="center" gap="2">
            <Text
              as="span"
              variant="body-medium"
              aria-hidden="true"
              style={{ color: 'inherit' }}
            >
              {row.expanded ? '⌄' : '›'}
            </Text>
            Grade {row.label}
          </Flex>,
        );
      }

      return (
        <Cell>
          <Flex align="center" gap="2">
            <Link href={row.repositoryHref}>{row.repositoryName}</Link>
            {row.catalogHref && (
              <Link
                href={row.catalogHref}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open ${row.repositoryName} in Red Hat Catalog`}
                title="Open in Red Hat Catalog"
              >
                <ExternalLinkIcon />
              </Link>
            )}
          </Flex>
        </Cell>
      );
    },
  },
  {
    id: 'tags',
    label: 'Tags',
    width: '3fr',
    cell: row =>
      row.kind === 'grade' ? (
        gradeCell(row, null)
      ) : (
        <Cell>
          {row.activeTags.length ? (
            <TagGroup aria-label={`Tags for ${row.repositoryName}`}>
              {row.activeTags.map((tag, index) => (
                <Tag
                  id={`${row.id}-tag-${index}`}
                  key={`${tag}-${index}`}
                  size="small"
                >
                  {tag}
                </Tag>
              ))}
            </TagGroup>
          ) : (
            <Text as="span" color="secondary">
              —
            </Text>
          )}
        </Cell>
      ),
  },
  {
    id: 'architecture',
    label: 'Architecture',
    width: '0.9fr',
    cell: row =>
      row.kind === 'grade' ? (
        gradeCell(row, null)
      ) : (
        <CellText title={row.architecture} />
      ),
  },
  {
    id: 'lastPushed',
    label: 'Last pushed',
    width: '1.5fr',
    cell: row =>
      row.kind === 'grade' ? (
        gradeCell(
          row,
          <Text
            as="span"
            variant="body-medium"
            style={{
              display: 'block',
              textAlign: 'right',
              fontVariantNumeric: 'tabular-nums',
              color: 'inherit',
            }}
          >
            {row.count.toLocaleString()} image{row.count === 1 ? '' : 's'}
          </Text>,
        )
      ) : (
        <Cell>
          <Timestamp value={row.lastPushedAt} />
        </Cell>
      ),
  },
];

export function Grades() {
  const { entity } = useEntity();
  const model = readEntity(entity);

  if (
    !model.value ||
    (model.value.category !== 'listing' &&
      model.value.category !== 'repository' &&
      model.value.category !== 'team')
  ) {
    return (
      <DetailCard title="Grades">
        <Text as="p" color="danger">
          {model.error ?? 'Managed entity category mismatch.'}
        </Text>
      </DetailCard>
    );
  }

  if (model.value.category === 'listing') {
    return <ListingGrades entity={entity} />;
  }
  if (model.value.category === 'repository') {
    return <RepositoryGrades entity={entity} />;
  }
  return <TeamGrades entity={entity} />;
}

function ListingGrades({ entity }: { entity: Entity }) {
  const related = useRelatedEntities(entity, PYXIS_RELATIONS.hasRepository);
  return (
    <GradesContent
      related={related}
      empty="No repositories are linked to this product listing."
    />
  );
}

function RepositoryGrades({ entity }: { entity: Entity }) {
  const related: RelatedState = {
    loading: false,
    entities: [entity],
    partial: false,
    retry: () => undefined,
  };
  return <GradesContent related={related} />;
}

function TeamGrades({ entity }: { entity: Entity }) {
  const related = useOwnedPortfolioRepositories(entity);
  return (
    <GradesContent
      related={related}
      empty="No repositories are owned by or linked to this team."
    />
  );
}

function GradesContent({
  related,
  empty = 'No repository observations available.',
}: {
  related: RelatedState;
  empty?: string;
}) {
  const entityRoute = useRouteRef(entityRouteRef);
  const location = useLocation();
  const repositories = related.entities.filter(
    repository => readEntity(repository).value?.category === 'repository',
  );
  const summary = aggregatePortfolioChi(repositories, Date.now());
  const sections = sectionsFromBuckets(summary.buckets);
  const expandedGrade = new URLSearchParams(location.search).get('grade');
  const rows = gradeRows(sections, expandedGrade, repository =>
    entityRoute(entityRouteParams(repository)),
  );
  const { tableProps } = useTable({
    mode: 'complete',
    data: rows,
    paginationOptions: { type: 'none' },
  });

  return (
    <DetailCard title="Container Health Index">
      <Flex direction="column" gap="4">
        <ChiObservationMetadata
          state={related}
          repositoryCount={repositories.length}
          summary={summary}
        />

        <Flex direction="column" gap="1">
          <Text as="p" variant="body-small" color="secondary">
            Each row shows the latest published CHI candidate selected for a
            configured stream and architecture. Last pushed is the most recent
            push date among the selected stream tags.
          </Text>
        </Flex>

        <AsyncState state={related} empty={empty}>
          <Flex direction="column" gap="3">
            {sections.length ? (
              <Table
                {...tableProps}
                columnConfig={gradeColumns}
                rowConfig={{
                  getHref: row =>
                    row.kind === 'grade'
                      ? gradeHref(
                          location.pathname,
                          location.search,
                          location.hash,
                          row.expanded ? undefined : row.sectionId,
                        )
                      : undefined,
                }}
              />
            ) : (
              <Text as="p" color="secondary">
                No images with a known grade are available.
              </Text>
            )}
            {(!summary.aggregate.complete || related.partial) && (
              <QualityNotice message="These grade counts are based on incomplete repository observations." />
            )}
          </Flex>
        </AsyncState>
      </Flex>
    </DetailCard>
  );
}
