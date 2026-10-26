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

import { useEntity } from '@backstage/plugin-catalog-react';
import { Flex } from '@backstage/ui';
import { useOwnedPortfolioEntities } from '../../hooks/useOwnedPortfolioEntities';
import { readEntity } from '../../model/entities';
import { QualityNotice } from '../shared/QualityNotice';
import { RelatedEntitiesTable } from '../shared/RelatedEntitiesTable';

export function TeamRepositories() {
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

  return <TeamRepositoriesContent team={entity} />;
}

function TeamRepositoriesContent({
  team,
}: {
  team: ReturnType<typeof useEntity>['entity'];
}) {
  const owned = useOwnedPortfolioEntities(team);

  return (
    <Flex direction="column" gap="4">
      {owned.error && <QualityNotice error message={owned.error} />}
      {owned.partial && (
        <QualityNotice message="Some repositories owned by this team are not available in the catalog." />
      )}
      <RelatedEntitiesTable
        category="repository"
        entities={owned.repositories}
        loading={owned.loading}
        emptyMessage="No repositories are owned by this team."
      />
    </Flex>
  );
}
