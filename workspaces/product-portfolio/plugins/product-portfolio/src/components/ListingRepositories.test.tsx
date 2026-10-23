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
import { ListingRepositories } from './ListingRepositories';

function CurrentPath() {
  const { pathname } = useLocation();
  return <output data-testid="current-path">{pathname}</output>;
}

async function renderListingRepositories(listing: Entity, entities: Entity[]) {
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

  return getEntitiesByRefs;
}

describe('ListingRepositories', () => {
  it('lists only linked repositories and opens a repository detail page on row click', async () => {
    const user = userEvent.setup();
    const entities = portfolioFixtures(13);
    const listing = entities.find(
      entity => entity.metadata.name === 'listing-1',
    )!;

    const getEntitiesByRefs = await renderListingRepositories(
      listing,
      entities,
    );

    expect(await screen.findByText('Repository 1')).toBeInTheDocument();
    expect(screen.getByText('Repository 3')).toBeInTheDocument();
    expect(screen.getByText('Repository 5')).toBeInTheDocument();
    expect(screen.queryByText('Repository 2')).not.toBeInTheDocument();
    expect(getEntitiesByRefs).toHaveBeenCalledWith({
      entityRefs: expect.arrayContaining([
        'resource:pyxis/repository-1',
        'resource:pyxis/repository-3',
        'resource:pyxis/repository-5',
      ]),
    });

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
    const getEntitiesByRefs = await renderListingRepositories(listing, [
      listing,
    ]);

    expect(
      await screen.findByText(
        'No repositories are linked to this product listing.',
      ),
    ).toBeInTheDocument();
    expect(getEntitiesByRefs).not.toHaveBeenCalled();
  });
});
