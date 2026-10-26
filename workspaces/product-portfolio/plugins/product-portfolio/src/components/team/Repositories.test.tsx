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
import { teamPortfolioFixtures } from '../../testUtils/fixtures';
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

    await renderTeamContent(<TeamProductListings />, team, entities);

    expect(await screen.findByText('Listing 1')).toBeInTheDocument();
    expect(screen.queryByText('Listing 2')).not.toBeInTheDocument();
  });
});
