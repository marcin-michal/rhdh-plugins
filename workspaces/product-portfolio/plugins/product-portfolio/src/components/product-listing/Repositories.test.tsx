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
import { PYXIS_RELATIONS } from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { fixtureEntity, portfolioFixtures } from '../../testUtils/fixtures';
import { ListingRepositories } from './Repositories';

function CurrentPath() {
  const { pathname } = useLocation();
  return <output data-testid="current-path">{pathname}</output>;
}

async function renderListingRepositories(listing: Entity, entities: Entity[]) {
  const catalogApi = new InMemoryCatalogClient({ entities });
  const queryEntities = jest.spyOn(catalogApi, 'queryEntities');
  const getEntitiesByRefs = jest.spyOn(catalogApi, 'getEntitiesByRefs');

  await renderInTestApp(
    <TestApiProvider apis={[[catalogApiRef, catalogApi]]}>
      <EntityProvider entity={listing}>
        <ListingRepositories />
      </EntityProvider>
      <CurrentPath />
    </TestApiProvider>,
    {
      mountedRoutes: {
        '/catalog/:namespace/:kind/:name': entityRouteRef,
      },
    },
  );

  return { queryEntities, getEntitiesByRefs };
}

describe('ListingRepositories', () => {
  it('lists only linked repositories and opens a repository detail page on row click', async () => {
    const user = userEvent.setup();
    const entities = portfolioFixtures(13);
    const listing = entities.find(
      entity => entity.metadata.name === 'listing-1',
    )!;

    const { queryEntities } = await renderListingRepositories(
      listing,
      entities,
    );

    expect(await screen.findByText('Repository 1')).toBeInTheDocument();
    expect(screen.getByText('Repository 3')).toBeInTheDocument();
    expect(screen.getByText('Repository 5')).toBeInTheDocument();
    expect(screen.queryByText('Repository 2')).not.toBeInTheDocument();
    expect(queryEntities).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: expect.objectContaining({
          'relations.pyxisRepositoryOf': 'resource:pyxis/listing-1',
        }),
        limit: 20,
        offset: 0,
      }),
    );

    const search = screen.getByRole('textbox', { name: 'Search by name' });
    await user.type(search, 'repository-3');
    await waitFor(() => {
      expect(screen.queryByText('Repository 1')).not.toBeInTheDocument();
      expect(screen.getByText('Repository 3')).toBeInTheDocument();
      expect(screen.queryByText('Repository 5')).not.toBeInTheDocument();
    });

    await user.clear(search);
    await waitFor(() =>
      expect(screen.getByText('Repository 1')).toBeInTheDocument(),
    );
    await user.type(search, 'not-a-repository');
    expect(
      await screen.findByText('No repositories match your search.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        'Some repositories linked to this product listing are not available in the catalog.',
      ),
    ).not.toBeInTheDocument();

    await user.clear(search);
    await waitFor(() =>
      expect(screen.getByText('Repository 1')).toBeInTheDocument(),
    );

    await user.click(screen.getByRole('row', { name: /Repository 1/ }));
    await waitFor(() =>
      expect(screen.getByTestId('current-path')).toHaveTextContent(
        '/catalog/pyxis/resource/repository-1',
      ),
    );
  });

  it('shows an empty state when the listing has no repository relations', async () => {
    const listing = fixtureEntity('listing');
    const { queryEntities } = await renderListingRepositories(listing, [
      listing,
    ]);

    expect(
      await screen.findByText(
        'No linked repositories are available in the catalog.',
      ),
    ).toBeInTheDocument();
    expect(queryEntities).toHaveBeenCalledTimes(1);
  });

  it('keeps the availability notice during search when a target lacks a reciprocal link', async () => {
    const user = userEvent.setup();
    const entities = portfolioFixtures(13);
    const listing = entities.find(
      entity => entity.metadata.name === 'listing-1',
    )!;
    const repository = entities.find(
      entity => entity.metadata.name === 'repository-3',
    )!;
    repository.relations = repository.relations?.filter(
      edge => edge.type !== PYXIS_RELATIONS.repositoryOf,
    );
    const { queryEntities, getEntitiesByRefs } =
      await renderListingRepositories(listing, entities);

    expect(await screen.findByText('Repository 1')).toBeInTheDocument();
    expect(screen.queryByText('Repository 3')).not.toBeInTheDocument();
    expect(queryEntities).toHaveBeenCalledTimes(1);
    expect(getEntitiesByRefs).not.toHaveBeenCalled();

    const search = screen.getByRole('textbox', { name: 'Search by name' });
    await user.type(search, 'not-a-repository');
    expect(
      await screen.findByText('No repositories match your search.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Some repositories linked to this product listing are not available in the catalog.',
      ),
    ).toBeInTheDocument();
  });

  it('uses the same relation filter for a listing with many outgoing refs', async () => {
    const entities = portfolioFixtures(13);
    const listing = entities.find(
      entity => entity.metadata.name === 'listing-1',
    )!;
    listing.relations!.push(
      ...Array.from({ length: 1_800 }, (_, index) => ({
        type: PYXIS_RELATIONS.hasRepository,
        targetRef: `resource:pyxis/r-${index.toString(32).padStart(52, 'a')}`,
      })),
    );

    const { queryEntities, getEntitiesByRefs } =
      await renderListingRepositories(listing, entities);

    expect(await screen.findByText('Repository 3')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Some repositories linked to this product listing are not available in the catalog.',
      ),
    ).toBeInTheDocument();
    expect(queryEntities).toHaveBeenCalledTimes(1);
    expect(queryEntities).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: expect.objectContaining({
          'relations.pyxisRepositoryOf': 'resource:pyxis/listing-1',
        }),
        fields: expect.not.arrayContaining(['relations']),
      }),
    );
    expect(getEntitiesByRefs).not.toHaveBeenCalled();
  });
});
