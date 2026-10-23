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

import {
  PYXIS_ANNOTATIONS,
  PYXIS_RELATIONS,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import type { Entity } from '@backstage/catalog-model';
import { parseEntityRef } from '@backstage/catalog-model';
import {
  processingResult,
  type CatalogProcessor,
  type CatalogProcessorEmit,
} from '@backstage/plugin-catalog-node';
import { ownedProjection, compoundRef } from './projection';

export class PyxisRelationshipProcessor implements CatalogProcessor {
  getProcessorName(): string {
    return 'PyxisRelationshipProcessor';
  }

  async postProcessEntity(
    entity: Entity,
    _location: unknown,
    emit: CatalogProcessorEmit,
  ): Promise<Entity> {
    const sourceInstance =
      entity.metadata.annotations?.[PYXIS_ANNOTATIONS.sourceInstance];
    if (
      !sourceInstance ||
      entity.metadata.annotations?.[PYXIS_ANNOTATIONS.sourceKind] !== 'listing'
    ) {
      return entity;
    }

    const p = ownedProjection(entity, sourceInstance);

    for (const association of p.associations?.associations ?? []) {
      if (association.status !== 'projected' || !association.entityRef) {
        continue;
      }

      const source = compoundRef(p);
      const target = parseEntityRef(association.entityRef);

      emit(
        processingResult.relation({
          source,
          target,
          type: PYXIS_RELATIONS.hasRepository,
        }),
      );
      emit(
        processingResult.relation({
          source: target,
          target: source,
          type: PYXIS_RELATIONS.repositoryOf,
        }),
      );
    }

    return entity;
  }
}
