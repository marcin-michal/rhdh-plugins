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
import { PYXIS_RELATIONS } from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import { useRelatedEntities } from '../hooks/useRelatedEntities';
import { readEntity } from '../model/entities';
import { ListingRepositoriesTable } from './ListingRepositoriesTable';
import { QualityNotice } from './QualityNotice';

export function ListingRepositories() {
  const { entity } = useEntity();
  const model = readEntity(entity);
  const related = useRelatedEntities(entity, PYXIS_RELATIONS.hasRepository);

  if (!model.value || model.value.category !== 'listing') {
    return (
      <QualityNotice
        error
        message={model.error ?? 'Managed entity category mismatch.'}
      />
    );
  }

  const repositories = related.entities.filter(
    repository => readEntity(repository).value?.category === 'repository',
  );

  return (
    <Flex direction="column" gap="4">
      {related.error && <QualityNotice error message={related.error} />}
      {related.partial && (
        <QualityNotice message="Some repositories linked to this product listing are not available in the catalog." />
      )}
      <ListingRepositoriesTable
        entities={repositories}
        loading={related.loading}
      />
    </Flex>
  );
}
