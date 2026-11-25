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

import type { QueryEntitiesRequest } from '@backstage/catalog-client';
import { InMemoryCatalogClient } from '@backstage/catalog-client/testUtils';
import type { CatalogApi } from '@backstage/plugin-catalog-react';
import { softwareIndexFixtures } from './entities';

class FixtureCatalogClient extends InMemoryCatalogClient {
  async queryEntities(request?: QueryEntitiesRequest) {
    // Give the table a render between starting and completing a fixture query.
    await new Promise<void>(resolve => {
      window.requestAnimationFrame(() => resolve());
    });

    return super.queryEntities(request);
  }
}

export function fixtureCatalog(): CatalogApi {
  const size = Number(
    new URLSearchParams(window.location.search).get('fixtureCount'),
  );

  return new FixtureCatalogClient({
    entities: softwareIndexFixtures(
      Number.isSafeInteger(size) && size > 0 ? size : 32,
    ),
  });
}
