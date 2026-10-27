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
import {
  PYXIS_RELATIONS,
  type SourceListing,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
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

function sourceListing(model: PortfolioEntity): SourceListing | undefined {
  if (model.category !== 'listing' || !model.projection.record) {
    return undefined;
  }

  return model.projection.record as SourceListing;
}

function ListingOverviewContent({ model }: { model: PortfolioEntity }) {
  const listing = sourceListing(model);
  const entityRoute = useRouteRef(entityRouteRef);
  const teamState = useRelatedEntities(model.entity, 'ownedBy');
  const repositories = useRelatedEntities(
    model.entity,
    PYXIS_RELATIONS.hasRepository,
  );
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
    listing?.team_id ||
    ownerRef ||
    'Not assigned';
  const teamRouteTarget = team ?? ownerRef;
  const teamHref = teamRouteTarget
    ? entityRoute(entityRouteParams(teamRouteTarget))
    : undefined;
  const listingHref = entityRoute(entityRouteParams(model.entity));
  const status = publicationStateLabel(publicationState(model));
  const description =
    listing?.descriptions?.long?.trim() ||
    model.entity.metadata.description?.trim() ||
    'No long description is available.';
  const support = listing?.support;
  const hasSupport =
    Boolean(support?.description) ||
    Boolean(support?.email_address) ||
    Boolean(support?.phone_number) ||
    Boolean(support?.url);
  const contacts = listing?.contacts ?? [];

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
            <DetailRow label="Publication status">
              <TagGroup aria-label="Source status">
                <Tag id="source-status" size="small">
                  {status}
                </Tag>
              </TagGroup>
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
              emptyMessage="No contacts are listed for this product."
            />
          </DetailCard>

          <DetailCard title="Support">
            <Flex direction="column" gap="3">
              {support?.description && (
                <Text
                  as="p"
                  variant="body-medium"
                  style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                >
                  {support.description}
                </Text>
              )}
              {hasSupport ? (
                <Flex direction="column" gap="2">
                  {support?.url && (
                    <DetailRow label="Support website">
                      <Link href={support.url} target="_blank" rel="noreferrer">
                        {support.url}
                      </Link>
                    </DetailRow>
                  )}
                  {support?.email_address && (
                    <DetailRow label="Email">
                      <Link href={`mailto:${support.email_address}`}>
                        {support.email_address}
                      </Link>
                    </DetailRow>
                  )}
                  {support?.phone_number && (
                    <DetailRow label="Phone">
                      <Link href={`tel:${support.phone_number}`}>
                        {support.phone_number}
                      </Link>
                    </DetailRow>
                  )}
                </Flex>
              ) : (
                <Text as="p" color="secondary">
                  No support information is available.
                </Text>
              )}
            </Flex>
          </DetailCard>

          <DetailCard title="Dates">
            <Flex direction="column" gap="3">
              <DetailRow label="Created in Pyxis">
                <Timestamp value={listing?.creation_date} />
              </DetailRow>
              <DetailRow label="Updated in Pyxis">
                <Timestamp value={listing?.last_update_date} />
              </DetailRow>
              <DetailRow label="Last checked by the catalog">
                <Timestamp value={model.projection.observation.observedAt} />
              </DetailRow>
            </Flex>
          </DetailCard>
        </Flex>

        {/* Keep the grade card at its natural height while the left stack grows. */}
        <Box style={{ flex: 1, minWidth: 0 }}>
          <GradesSummary state={repositories} entityHref={listingHref} />
        </Box>
      </Flex>
      {teamState.error && (
        <QualityNotice message="The team name could not be loaded from the catalog." />
      )}
    </Flex>
  );
}

export function ListingOverview() {
  const { entity } = useEntity();
  const model = readEntity(entity);

  if (!model.value || model.value.category !== 'listing') {
    return (
      <QualityNotice
        error
        message={model.error ?? 'Managed entity category mismatch.'}
      />
    );
  }

  return <ListingOverviewContent model={model.value} />;
}
