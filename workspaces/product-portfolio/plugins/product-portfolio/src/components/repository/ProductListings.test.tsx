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
import { fixtureEntity, portfolioFixtures } from '../../testUtils/fixtures';
import { RepositoryProductListings } from './ProductListings';

function CurrentPath() {
  const { pathname } = useLocation();
  return <output data-testid="current-path">{pathname}</output>;
}

async function renderRepositoryProductListings(
  repository: Entity,
  entities: Entity[],
) {
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
      <EntityProvider entity={repository}>
        <RepositoryProductListings />
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

describe('RepositoryProductListings', () => {
  it('lists product listings that have this repository and opens listing details', async () => {
    const user = userEvent.setup();
    const entities = portfolioFixtures(13);
    const repository = entities.find(
      entity => entity.metadata.name === 'repository-1',
    )!;

    const getEntitiesByRefs = await renderRepositoryProductListings(
      repository,
      entities,
    );

    expect(await screen.findByText('Listing 1')).toBeInTheDocument();
    expect(screen.queryByText('Listing 2')).not.toBeInTheDocument();
    expect(getEntitiesByRefs).toHaveBeenCalledWith({
      entityRefs: ['resource:pyxis/listing-1'],
    });

    const search = screen.getByRole('textbox', { name: 'Search by name' });
    await user.type(search, 'listing-1');
    await waitFor(() => {
      expect(screen.getByText('Listing 1')).toBeInTheDocument();
    });
    await user.clear(search);
    await user.type(search, 'not-a-listing');
    expect(
      await screen.findByText('No product listings match your search.'),
    ).toBeInTheDocument();

    await user.clear(search);
    await waitFor(() =>
      expect(screen.getByText('Listing 1')).toBeInTheDocument(),
    );
    await user.click(screen.getByRole('row', { name: /Listing 1/ }));
    await waitFor(() =>
      expect(screen.getByTestId('current-path')).toHaveTextContent(
        '/catalog/pyxis/resource/listing-1',
      ),
    );
  });

  it('shows an empty state when the repository has no listing relations', async () => {
    const repository = fixtureEntity('repository');
    const getEntitiesByRefs = await renderRepositoryProductListings(
      repository,
      [repository],
    );

    expect(
      await screen.findByText(
        'No product listings are linked to this repository.',
      ),
    ).toBeInTheDocument();
    expect(getEntitiesByRefs).not.toHaveBeenCalled();
  });
});
