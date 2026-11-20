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

import { InMemoryCatalogClient } from '@backstage/catalog-client/testUtils';
import type { Entity } from '@backstage/catalog-model';
import {
  catalogApiRef,
  EntityProvider,
  entityRouteRef,
} from '@backstage/plugin-catalog-react';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import {
  portfolioFixtures,
  teamPortfolioFixtures,
} from '../../testUtils/fixtures';
import { TeamProductListings } from './ProductListings';
import { TeamRepositories } from './Repositories';

function CurrentLocation() {
  const { pathname } = useLocation();
  return <output data-testid="current-location">{pathname}</output>;
}

async function renderTeamContent(
  component: React.ReactNode,
  team: Entity,
  entities: Entity[],
) {
  const catalogApi = new InMemoryCatalogClient({ entities });
  const queryCatalog = catalogApi.queryEntities.bind(catalogApi);
  const queryEntities = jest
    .spyOn(catalogApi, 'queryEntities')
    .mockImplementation(async request => {
      // Let the table render its loading state, as it would with a catalog request.
      await new Promise<void>(resolve =>
        window.requestAnimationFrame(() => resolve()),
      );
      return queryCatalog(request);
    });
  const getEntitiesByRefs = jest.spyOn(catalogApi, 'getEntitiesByRefs');

  await renderInTestApp(
    <TestApiProvider apis={[[catalogApiRef, catalogApi]]}>
      <EntityProvider entity={team}>{component}</EntityProvider>
      <CurrentLocation />
    </TestApiProvider>,
    {
      routeEntries: ['/catalog/pyxis/group/team-1'],
      mountedRoutes: {
        '/catalog/:namespace/:kind/:name': entityRouteRef,
      },
    },
  );
  return { queryEntities, getEntitiesByRefs };
}

describe('Team owned entity tabs', () => {
  it('lists only directly owned repositories and navigates to repository details', async () => {
    const user = userEvent.setup();
    const entities = teamPortfolioFixtures();
    const team = entities.find(entity => entity.metadata.name === 'team-1')!;

    await renderTeamContent(<TeamRepositories />, team, entities);

    expect(await screen.findByText('Repository 3')).toBeInTheDocument();
    expect(screen.getByText('Repository 5')).toBeInTheDocument();
    expect(screen.queryByText('Repository 1')).not.toBeInTheDocument();
    await user.click(screen.getByRole('row', { name: /Repository 3/ }));
    await waitFor(() => {
      expect(screen.getByTestId('current-location')).toHaveTextContent(
        '/catalog/pyxis/resource/repository-3',
      );
    });
  });

  it('lists only directly owned product listings', async () => {
    const entities = teamPortfolioFixtures();
    const team = entities.find(entity => entity.metadata.name === 'team-1')!;

    const { queryEntities } = await renderTeamContent(
      <TeamProductListings />,
      team,
      entities,
    );

    expect(await screen.findByText('Listing 1')).toBeInTheDocument();
    expect(screen.queryByText('Listing 2')).not.toBeInTheDocument();
    expect(queryEntities).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: expect.objectContaining({
          'relations.ownedBy': 'group:pyxis/team-1',
          'spec.type': 'pyxis-product-listing',
        }),
        limit: 20,
        offset: 0,
      }),
    );
  });

  it('paginates, searches and sorts large ownership sets in the catalog', async () => {
    const user = userEvent.setup();
    const entities = portfolioFixtures(250);
    for (const entity of entities) {
      const index = entity.metadata.name.match(/^repository-(\d+)$/)?.[1];
      if (index) {
        entity.metadata.title = `Repository ${index.padStart(4, '0')}`;
      }
    }
    const team = entities.find(entity => entity.metadata.name === 'team-1')!;
    const { queryEntities, getEntitiesByRefs } = await renderTeamContent(
      <TeamRepositories />,
      team,
      entities,
    );

    expect(await screen.findByText('Repository 0001')).toBeInTheDocument();
    expect(screen.queryByText('Repository 0041')).not.toBeInTheDocument();
    expect(queryEntities).toHaveBeenCalledTimes(1);
    expect(queryEntities).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: expect.objectContaining({
          'relations.ownedBy': 'group:pyxis/team-1',
          'spec.type': 'container-repository',
        }),
        limit: 20,
        offset: 0,
        fields: expect.not.arrayContaining(['relations']),
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Next table page' }));
    expect(await screen.findByText('Repository 0041')).toBeInTheDocument();
    expect(queryEntities).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 20, offset: 20 }),
    );

    const search = screen.getByRole('textbox', { name: 'Search by name' });
    await user.type(search, 'repository-241');
    expect(await screen.findByText('Repository 0241')).toBeInTheDocument();
    expect(queryEntities).toHaveBeenLastCalledWith(
      expect.objectContaining({
        offset: 0,
        fullTextFilter: {
          term: 'repository-241',
          fields: ['metadata.title', 'metadata.name'],
        },
      }),
    );

    await user.clear(search);
    expect(await screen.findByText('Repository 0001')).toBeInTheDocument();
    await user.click(screen.getByRole('columnheader', { name: /Name/ }));
    expect(await screen.findByText('Repository 0243')).toBeInTheDocument();
    expect(queryEntities).toHaveBeenLastCalledWith(
      expect.objectContaining({
        offset: 0,
        orderFields: { field: 'metadata.title', order: 'desc' },
      }),
    );
    expect(getEntitiesByRefs).not.toHaveBeenCalled();
  });
});
