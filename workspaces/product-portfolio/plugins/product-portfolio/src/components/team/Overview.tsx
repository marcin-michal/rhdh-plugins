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
import { Box, Flex } from '@backstage/ui';
import { useOwnedPortfolioRepositories } from '../../hooks/useOwnedPortfolioEntities';
import { useRelatedEntities } from '../../hooks/useRelatedEntities';
import { readEntity } from '../../model/entities';
import { GradesSummary } from '../grades/GradesSummary';
import { DetailCard } from '../shared/DetailCard';
import { DetailRow } from '../shared/DetailRow';
import { QualityNotice } from '../shared/QualityNotice';
import { TeamMembersTable } from './MembersTable';

export function TeamOverview() {
  const { entity } = useEntity();
  const model = readEntity(entity);

  if (!model.value || model.value.category !== 'team') {
    return (
      <QualityNotice
        error
        message={model.error ?? 'Managed entity category mismatch.'}
      />
    );
  }

  return (
    <TeamOverviewContent
      team={entity}
      pyxisId={model.value.projection.source.id}
    />
  );
}

function TeamOverviewContent({
  team,
  pyxisId,
}: {
  team: ReturnType<typeof useEntity>['entity'];
  pyxisId: string;
}) {
  const entityRoute = useRouteRef(entityRouteRef);
  const members = useRelatedEntities(team, 'hasMember');
  const repositories = useOwnedPortfolioRepositories(team);
  const teamHref = entityRoute(entityRouteParams(team));

  return (
    <Flex direction="column" gap="4">
      <DetailCard title="Team information">
        <DetailRow label="Pyxis ID">{pyxisId}</DetailRow>
      </DetailCard>
      <Flex
        direction={{ initial: 'column', md: 'row' }}
        align={{ initial: 'stretch', md: 'start' }}
        gap="4"
      >
        <Box style={{ flex: '1 1 0%', minWidth: 0 }}>
          <TeamMembersTable team={team} state={members} />
        </Box>
        <Box style={{ flex: '1 1 0%', minWidth: 0 }}>
          <GradesSummary state={repositories} entityHref={teamHref} />
        </Box>
      </Flex>
    </Flex>
  );
}
