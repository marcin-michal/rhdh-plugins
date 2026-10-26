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
import type { PyxisProjection } from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import { teamPortfolioFixtures } from '../../testUtils/fixtures';
import { TeamOverview } from './Overview';

function CurrentLocation() {
  const { pathname, search } = useLocation();
  return <output data-testid="current-location">{pathname + search}</output>;
}

async function renderTeamOverview(team: Entity, entities: Entity[]) {
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
      <EntityProvider entity={team}>
        <TeamOverview />
      </EntityProvider>
      <CurrentLocation />
    </TestApiProvider>,
    {
      routeEntries: ['/catalog/pyxis/group/team-1'],
      mountedRoutes: {
        '/catalog/:namespace/:kind/:name': entityRouteRef,
      },
    },
  );

  return getEntitiesByRefs;
}

describe('TeamOverview', () => {
  it('shows the Pyxis ID, roster members, and grades from direct and listing repositories', async () => {
    const user = userEvent.setup();
    const entities = teamPortfolioFixtures();
    const team = entities.find(entity => entity.metadata.name === 'team-1')!;
    const projection = team.spec!.pyxis as unknown as PyxisProjection;
    const getEntitiesByRefs = await renderTeamOverview(team, entities);

    expect(
      screen.getByRole('heading', { name: 'Team information' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Pyxis ID')).toBeInTheDocument();
    expect(screen.getByText(projection.source.id)).toBeInTheDocument();
    expect(
      await screen.findByRole('row', { name: /User 1/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /User 2/ })).toBeInTheDocument();
    expect(screen.getAllByText('maintainer')).toHaveLength(2);
    expect(
      await screen.findByRole('rowheader', { name: 'A' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('gridcell', { name: '2' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'B' })).toBeInTheDocument();
    expect(screen.getByRole('gridcell', { name: '1' })).toBeInTheDocument();
    await user.click(screen.getByRole('row', { name: /User 1/ }));
    await waitFor(() => {
      expect(screen.getByTestId('current-location')).toHaveTextContent(
        '/catalog/pyxis/user/user-1',
      );
    });

    const requestedRefs = getEntitiesByRefs.mock.calls.flatMap(
      ([request]) => request.entityRefs,
    );
    expect(requestedRefs).toEqual(
      expect.arrayContaining([
        'resource:pyxis/repository-1',
        'resource:pyxis/repository-3',
        'resource:pyxis/repository-5',
      ]),
    );

    await user.click(screen.getByRole('rowheader', { name: 'A' }));
    await waitFor(() => {
      expect(screen.getByTestId('current-location')).toHaveTextContent(
        '/catalog/pyxis/group/team-1/grades?grade=a',
      );
    });
  });
});
