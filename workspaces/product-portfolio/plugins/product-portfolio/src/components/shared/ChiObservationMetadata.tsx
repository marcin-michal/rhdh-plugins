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

import { Flex, Grid, Text, type TextColorStatus } from '@backstage/ui';
import type { RelatedState } from '../../hooks/useRelatedEntities';
import type { PortfolioChiSummary } from '../../model/portfolioChi';
import { Timestamp } from './Timestamp';

export function ChiObservationMetadata({
  state,
  repositoryCount,
  summary,
}: {
  state: RelatedState;
  repositoryCount: number;
  summary: Pick<
    PortfolioChiSummary,
    'aggregate' | 'snapshotsUsed' | 'latestObservationAt'
  >;
}) {
  let observationStatus = 'Incomplete';
  let observationColor: TextColorStatus = 'warning';
  if (state.loading) {
    observationStatus = 'Loading';
    observationColor = 'info';
  } else if (state.error) {
    observationStatus = 'Unavailable';
    observationColor = 'danger';
  } else if (repositoryCount === 0) {
    observationStatus = 'No observations';
  } else if (summary.aggregate.complete && !state.partial) {
    observationStatus = 'Complete';
    observationColor = 'success';
  }

  return (
    <Grid.Root columns={{ initial: '1', sm: '2' }} gap="3">
      <Grid.Item>
        <Flex direction="column" gap="1">
          <Text as="p" variant="body-small" color="secondary">
            Observation status
          </Text>
          <Text as="p" variant="body-medium" color={observationColor}>
            {observationStatus}
          </Text>
        </Flex>
      </Grid.Item>
      <Grid.Item>
        <Flex direction="column" gap="1">
          <Text as="p" variant="body-small" color="secondary">
            Latest grade observation
          </Text>
          <Text as="p" variant="body-medium">
            <Timestamp value={summary.latestObservationAt} />
          </Text>
        </Flex>
      </Grid.Item>
    </Grid.Root>
  );
}
