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
import {
  catalogApiRef,
  EntityProvider,
  entityRouteRef,
} from '@backstage/plugin-catalog-react';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { fixtureEntity, portfolioFixtures } from '../testUtils/fixtures';
import { ListingOverview } from './ListingOverview';

function CurrentLocation() {
  const { pathname, search } = useLocation();
  return <output data-testid="current-location">{pathname + search}</output>;
}

describe('ListingOverview', () => {
  it('renders listing details and aggregate repository grade information', async () => {
    const entities = portfolioFixtures(13);
    const listing = entities.find(
      entity => entity.metadata.name === 'listing-1',
    )!;
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

    await renderInTestApp(
      <TestApiProvider apis={[[catalogApiRef, { getEntitiesByRefs }]]}>
        <EntityProvider entity={listing}>
          <ListingOverview />
        </EntityProvider>
      </TestApiProvider>,
      {
        mountedRoutes: {
          '/catalog/:namespace/:kind/:name': entityRouteRef,
        },
      },
    );

    expect(
      await screen.findByText('Long description for listing 1'),
    ).toBeInTheDocument();
    expect(screen.getByText(/team 1/i)).toBeInTheDocument();
    expect(screen.getByText('Published')).toBeInTheDocument();
    expect(screen.getByText(/repository snapshots/)).toBeInTheDocument();
    expect(await screen.findByText('A', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Incomplete')).toBeInTheDocument();
    expect(getEntitiesByRefs).toHaveBeenCalled();
  });

  it('reports an entity category mismatch instead of rendering listing details', async () => {
    await renderInTestApp(
      <EntityProvider entity={fixtureEntity('repository')}>
        <ListingOverview />
      </EntityProvider>,
    );

    expect(
      screen.getByText('Managed entity category mismatch.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('No long description is available.'),
    ).not.toBeInTheDocument();
  });

  it('opens the matching grade section on the Grades tab from a grade row', async () => {
    const user = userEvent.setup();
    const entities = portfolioFixtures(13);
    const listing = entities.find(
      entity => entity.metadata.name === 'listing-1',
    )!;
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

    await renderInTestApp(
      <TestApiProvider apis={[[catalogApiRef, { getEntitiesByRefs }]]}>
        <EntityProvider entity={listing}>
          <ListingOverview />
        </EntityProvider>
        <CurrentLocation />
      </TestApiProvider>,
      {
        routeEntries: ['/catalog/pyxis/resource/listing-1'],
        mountedRoutes: {
          '/catalog/:namespace/:kind/:name': entityRouteRef,
        },
      },
    );

    const gradeRow = await screen.findByRole('row', { name: /^A\s+1$/ });
    await user.click(gradeRow);

    await waitFor(() => {
      expect(screen.getByTestId('current-location')).toHaveTextContent(
        '/catalog/pyxis/resource/listing-1/grades?grade=a',
      );
    });
  });
});
