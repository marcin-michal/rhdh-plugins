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
import { PYXIS_RELATIONS } from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import { readEntity } from '../../model/entities';
import { QualityNotice } from '../shared/QualityNotice';
import { RelatedEntitiesTable } from '../shared/RelatedEntitiesTable';

export function RepositoryProductListings() {
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

  return (
    <RelatedEntitiesTable
      source={entity}
      inverseRelation={PYXIS_RELATIONS.hasRepository}
      category="listing"
      availability={{
        relation: PYXIS_RELATIONS.repositoryOf,
        message:
          'Some product listings linked to this repository are not available in the catalog.',
      }}
    />
  );
}
