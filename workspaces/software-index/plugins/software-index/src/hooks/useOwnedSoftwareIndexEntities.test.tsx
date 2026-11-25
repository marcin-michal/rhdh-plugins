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

import { stringifyEntityRef } from '@backstage/catalog-model';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { TestApiProvider } from '@backstage/test-utils';
import { renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { teamSoftwareIndexFixtures } from '../testUtils/fixtures';
import { useOwnedSoftwareIndexRepositories } from './useOwnedSoftwareIndexEntities';

describe('useOwnedSoftwareIndexRepositories', () => {
  it('includes repositories linked from owned listings and deduplicates direct ownership', async () => {
    const entities = teamSoftwareIndexFixtures();
    const team = entities.find(entity => entity.metadata.name === 'team-1')!;
    const entitiesByRef = new Map(
      entities.map(entity => [stringifyEntityRef(entity), entity]),
    );
    const getEntitiesByRefs = jest.fn(
      async ({ entityRefs }: { entityRefs: string[] }) => ({
        items: entityRefs.map(ref => entitiesByRef.get(ref)),
      }),
    );
    const catalogApi = { getEntitiesByRefs };
    const wrapper = ({ children }: PropsWithChildren) => (
      <TestApiProvider apis={[[catalogApiRef, catalogApi]]}>
        {children}
      </TestApiProvider>
    );

    const { result, rerender } = renderHook(
      () => useOwnedSoftwareIndexRepositories(team),
      { wrapper },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entities.map(entity => entity.metadata.name)).toEqual(
      ['repository-1', 'repository-3', 'repository-5'],
    );
    expect(result.current.partial).toBe(false);
    expect(
      getEntitiesByRefs.mock.calls.flatMap(([request]) => request.entityRefs),
    ).toEqual([
      'resource:pyxis/listing-1',
      'resource:pyxis/repository-3',
      'resource:pyxis/repository-5',
      'resource:pyxis/repository-1',
    ]);

    const repositories = result.current.entities;
    rerender();
    expect(result.current.entities).toBe(repositories);
  });
});
