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

import { useCallback, useMemo, useRef } from 'react';
import type { Entity } from '@backstage/catalog-model';
import { useEntity } from '@backstage/plugin-catalog-react';
import { Flex, Text } from '@backstage/ui';
import { PYXIS_RELATIONS } from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  useRelatedEntities,
  type RelatedState,
} from '../../hooks/useRelatedEntities';
import { useOwnedPortfolioRepositories } from '../../hooks/useOwnedPortfolioEntities';
import { readEntity } from '../../model/entities';
import {
  collectPortfolioChiData,
  summarizePortfolioChiData,
  type ImageOccurrence,
  type PortfolioChiBucket,
} from '../../model/portfolioChi';
import { AsyncState } from '../shared/AsyncState';
import { ChiObservationMetadata } from '../shared/ChiObservationMetadata';
import { DetailCard } from '../shared/DetailCard';
import {
  GradeSectionTable,
  type GradeSection,
  type GradeSectionId,
} from './GradeSectionTable';

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
  const entities = useMemo(() => [entity], [entity]);
  const related = useMemo<RelatedState>(
    () => ({
      loading: false,
      entities,
      partial: false,
      retry: () => undefined,
    }),
    [entities],
  );

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
  const location = useLocation();
  const navigate = useNavigate();
  const repositories = useMemo(
    () =>
      related.entities.filter(
        repository => readEntity(repository).value?.category === 'repository',
      ),
    [related.entities],
  );
  const portfolioData = useMemo(
    () => collectPortfolioChiData(repositories),
    [repositories],
  );
  const summary = useMemo(
    () => summarizePortfolioChiData(portfolioData, Date.now()),
    [portfolioData],
  );
  const sections = useMemo(
    () => sectionsFromBuckets(portfolioData.buckets),
    [portfolioData.buckets],
  );
  const expandedGrade = new URLSearchParams(location.search).get('grade');
  const currentLocation = useRef(location);
  currentLocation.current = location;

  const toggleGrade = useCallback(
    (grade: GradeSectionId, expanded: boolean) => {
      const current = currentLocation.current;
      navigate(
        gradeHref(
          current.pathname,
          current.search,
          current.hash,
          expanded ? grade : undefined,
        ),
      );
    },
    [navigate],
  );

  return (
    <DetailCard title="Container Health Index">
      <Flex direction="column" gap="4">
        <ChiObservationMetadata
          state={related}
          repositoryCount={repositories.length}
          summary={summary}
          showObservationStatus={false}
        />

        <Flex direction="column" gap="1">
          <Text as="p" variant="body-small" color="secondary">
            Each row shows the latest published CHI candidate selected for a
            configured stream and architecture. Last pushed is the most recent
            push date among the selected stream tags.
          </Text>
        </Flex>

        <AsyncState state={related} empty={empty} showPartialWarning={false}>
          <Flex direction="column" gap="3">
            {sections.length ? (
              <Flex direction="column" gap="2">
                {sections.map(section => (
                  <GradeSectionTable
                    key={section.id}
                    section={section}
                    expanded={expandedGrade === section.id}
                    onToggle={toggleGrade}
                  />
                ))}
              </Flex>
            ) : (
              <Text as="p" color="secondary">
                No images with a known grade are available.
              </Text>
            )}
          </Flex>
        </AsyncState>
      </Flex>
    </DetailCard>
  );
}
