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

import { stringifyEntityRef, type Entity } from '@backstage/catalog-model';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { TestApiProvider } from '@backstage/test-utils';
import { renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import {
  portfolioFixtures,
  teamPortfolioFixtures,
} from '../testUtils/fixtures';
import {
  useOwnedPortfolioEntities,
  useOwnedPortfolioRepositories,
} from './useOwnedPortfolioEntities';

describe('useOwnedPortfolioEntities', () => {
  it('returns only owned portfolio listings and repositories', async () => {
    const entities = portfolioFixtures(13);
    const team = entities.find(entity => entity.metadata.name === 'team-1')!;
    const entitiesByRef = new Map(
      entities.map(entity => [stringifyEntityRef(entity), entity]),
    );
    const getEntitiesByRefs = jest.fn(
      async ({ entityRefs }: { entityRefs: string[] }) => ({
        items: entityRefs
          .map(ref => entitiesByRef.get(ref))
          .filter((entity): entity is Entity => Boolean(entity)),
      }),
    );
    const wrapper = ({ children }: PropsWithChildren) => (
      <TestApiProvider apis={[[catalogApiRef, { getEntitiesByRefs }]]}>
        {children}
      </TestApiProvider>
    );

    const { result } = renderHook(() => useOwnedPortfolioEntities(team), {
      wrapper,
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.listings.map(entity => entity.metadata.name)).toEqual(
      ['listing-1'],
    );
    expect(result.current.repositories).toHaveLength(3);
    expect(result.current.entities).toHaveLength(4);
    expect(
      result.current.entities.every(entity => entity.kind !== 'User'),
    ).toBe(true);
    expect(result.current.partial).toBe(false);
  });

  it('includes repositories linked from owned listings and deduplicates direct ownership', async () => {
    const entities = teamPortfolioFixtures();
    const team = entities.find(entity => entity.metadata.name === 'team-1')!;
    const entitiesByRef = new Map(
      entities.map(entity => [stringifyEntityRef(entity), entity]),
    );
    const getEntitiesByRefs = jest.fn(
      async ({ entityRefs }: { entityRefs: string[] }) => ({
        items: entityRefs
          .map(ref => entitiesByRef.get(ref))
          .filter((entity): entity is Entity => Boolean(entity)),
      }),
    );
    const wrapper = ({ children }: PropsWithChildren) => (
      <TestApiProvider apis={[[catalogApiRef, { getEntitiesByRefs }]]}>
        {children}
      </TestApiProvider>
    );

    const { result } = renderHook(() => useOwnedPortfolioRepositories(team), {
      wrapper,
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entities.map(entity => entity.metadata.name)).toEqual(
      ['repository-1', 'repository-3', 'repository-5'],
    );
    expect(result.current.partial).toBe(false);
  });
});
