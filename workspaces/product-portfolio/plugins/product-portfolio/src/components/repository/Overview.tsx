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

import { useRouteRef } from '@backstage/core-plugin-api';
import {
  entityRouteParams,
  entityRouteRef,
  useEntity,
} from '@backstage/plugin-catalog-react';
import { Box, Flex, Link, Tag, TagGroup, Text } from '@backstage/ui';
import type { SourceRepository } from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import { useRelatedEntities } from '../../hooks/useRelatedEntities';
import { readEntity, type PortfolioEntity } from '../../model/entities';
import {
  publicationState,
  publicationStateLabel,
} from '../../model/publicationState';
import { GradesSummary } from '../grades/GradesSummary';
import { QualityNotice } from '../shared/QualityNotice';
import { ContactList } from '../shared/ContactList';
import { DetailCard } from '../shared/DetailCard';
import { DetailRow } from '../shared/DetailRow';
import { Timestamp } from '../shared/Timestamp';

function ValueTags({
  ariaLabel,
  idPrefix,
  values,
}: {
  ariaLabel: string;
  idPrefix: string;
  values?: string[] | null;
}) {
  const available = values?.map(value => value.trim()).filter(Boolean) ?? [];

  if (!available.length) {
    return (
      <Text as="span" color="secondary">
        Not available
      </Text>
    );
  }

  return (
    <TagGroup aria-label={ariaLabel}>
      {available.map((value, index) => (
        <Tag id={`${idPrefix}-${index}`} key={`${value}-${index}`} size="small">
          {value}
        </Tag>
      ))}
    </TagGroup>
  );
}

function documentationLinkLabel(title: string, url: string): string {
  const trimmedTitle = title.trim();
  return !trimmedTitle || trimmedTitle.toLowerCase() === 'unknown'
    ? url
    : trimmedTitle;
}

function RepositoryOverviewContent({
  model,
  repository,
  observedAt,
}: {
  model: PortfolioEntity;
  repository: SourceRepository;
  observedAt?: string;
}) {
  const entityRoute = useRouteRef(entityRouteRef);
  const teamState = useRelatedEntities(model.entity, 'ownedBy');
  const team = teamState.entities[0];
  const teamModel = team ? readEntity(team).value : undefined;
  const teamRecord =
    teamModel?.category === 'team' ? teamModel.projection.record : undefined;
  const sourceTeamName =
    teamRecord && 'name' in teamRecord && typeof teamRecord.name === 'string'
      ? teamRecord.name.trim()
      : '';
  const specOwner = model.entity.spec?.owner;
  const ownerRef =
    model.entity.relations?.find(relation => relation.type === 'ownedBy')
      ?.targetRef ?? (typeof specOwner === 'string' ? specOwner : undefined);
  const teamName =
    sourceTeamName ||
    team?.metadata.title ||
    (teamState.loading && !team ? 'Loading team…' : undefined) ||
    team?.metadata.name ||
    repository.team_id ||
    ownerRef ||
    'Not assigned';
  const teamRouteTarget = team ?? ownerRef;
  const teamHref = teamRouteTarget
    ? entityRoute(entityRouteParams(teamRouteTarget))
    : undefined;
  const repositoryHref = entityRoute(entityRouteParams(model.entity));
  const description =
    repository.display_data?.long_description?.trim() ||
    model.entity.metadata.description?.trim() ||
    'No long description is available.';
  const contacts = repository.contacts ?? [];
  const documentationLinks = (repository.documentation_links ?? []).filter(
    link => link.url.trim(),
  );
  const pulls = repository.metrics?.pulls_in_last_30_days;

  return (
    <Flex direction="column" gap="4">
      <DetailCard title="About">
        <Flex
          direction={{ initial: 'column', md: 'row' }}
          align={{ initial: 'stretch', md: 'start' }}
          gap="4"
        >
          <Box style={{ flex: '2 1 0%', minWidth: 0 }}>
            <Text
              as="p"
              variant="body-medium"
              style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
            >
              {description}
            </Text>
          </Box>
          <Flex
            direction="column"
            gap="3"
            style={{ flex: '1 1 0%', minWidth: 0 }}
          >
            <DetailRow label="Team">
              {teamHref ? (
                <Link href={teamHref}>{teamName}</Link>
              ) : (
                <Text as="span">{teamName}</Text>
              )}
            </DetailRow>
            <DetailRow label="Pyxis ID">{model.projection.source.id}</DetailRow>
            <DetailRow label="Repository">
              {repository.repository?.trim() || 'Not available'}
            </DetailRow>
            <DetailRow label="Registry">
              {repository.registry?.trim() || 'Not available'}
            </DetailRow>
            <DetailRow label="Publication status">
              <TagGroup aria-label="Publication status">
                <Tag id="repository-publication-status" size="small">
                  {publicationStateLabel(publicationState(model))}
                </Tag>
              </TagGroup>
            </DetailRow>
            <DetailRow label="Release categories">
              <ValueTags
                ariaLabel="Release categories"
                idPrefix="release-category"
                values={repository.release_categories}
              />
            </DetailRow>
            <DetailRow label="Architectures">
              <ValueTags
                ariaLabel="Architectures"
                idPrefix="architecture"
                values={repository.architectures}
              />
            </DetailRow>
          </Flex>
        </Flex>
      </DetailCard>

      <Flex
        direction={{ initial: 'column', md: 'row' }}
        align={{ initial: 'stretch', md: 'start' }}
        gap="4"
      >
        <Flex direction="column" gap="4" style={{ flex: 1, minWidth: 0 }}>
          <DetailCard title="Contacts">
            <ContactList
              contacts={contacts}
              emptyMessage="No contacts are listed for this repository."
            />
          </DetailCard>

          <DetailCard title="Documentation links">
            {documentationLinks.length ? (
              <Flex direction="column" gap="3">
                {documentationLinks.map((link, index) => (
                  <Link
                    key={`${link.url}:${index}`}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {documentationLinkLabel(link.title, link.url)}
                  </Link>
                ))}
              </Flex>
            ) : (
              <Text as="p" color="secondary">
                No documentation links are available.
              </Text>
            )}
          </DetailCard>

          <DetailCard title="Metrics">
            <DetailRow label="Pulls in the last 30 days">
              {typeof pulls === 'number' && Number.isFinite(pulls)
                ? pulls.toLocaleString()
                : 'Not available'}
            </DetailRow>
          </DetailCard>

          <DetailCard title="Dates">
            <Flex direction="column" gap="3">
              <DetailRow label="Created in Pyxis">
                <Timestamp value={repository.creation_date} />
              </DetailRow>
              <DetailRow label="Updated in Pyxis">
                <Timestamp value={repository.last_update_date} />
              </DetailRow>
              <DetailRow label="Metrics updated">
                <Timestamp value={repository.metrics?.last_update_date} />
              </DetailRow>
              <DetailRow label="Last checked by the catalog">
                <Timestamp value={observedAt} />
              </DetailRow>
            </Flex>
          </DetailCard>
        </Flex>

        <Box style={{ flex: 1, minWidth: 0 }}>
          <GradesSummary
            state={{
              loading: false,
              entities: [model.entity],
              partial: false,
              retry: () => undefined,
            }}
            entityHref={repositoryHref}
          />
        </Box>
      </Flex>
      {teamState.error && (
        <QualityNotice message="The team name could not be loaded from the catalog." />
      )}
    </Flex>
  );
}

export function RepositoryOverview() {
  const { entity } = useEntity();
  const model = readEntity(entity);

  if (!model.value || model.value.category !== 'repository') {
    return (
      <QualityNotice
        error
        message={model.error ?? 'Managed entity category mismatch.'}
      />
    );
  }

  const repository = model.value.projection.record as
    | SourceRepository
    | undefined;
  if (!repository) {
    return (
      <QualityNotice error message="Repository source data is unavailable." />
    );
  }

  return (
    <RepositoryOverviewContent
      model={model.value}
      repository={repository}
      observedAt={model.value.projection.observation.observedAt}
    />
  );
}
