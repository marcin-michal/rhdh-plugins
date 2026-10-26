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

import type { Entity } from '@backstage/catalog-model';
import { entityRouteRef } from '@backstage/plugin-catalog-react';
import { renderInTestApp } from '@backstage/test-utils';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readEntity, sourceKey } from '../model/entities';
import {
  fixtureEntity,
  observedAt,
  portfolioFixtures,
} from '../testUtils/fixtures';
import { PortfolioTable } from './PortfolioTable';
import type { PortfolioTeam } from './columns';
import type { PortfolioCategory } from './filterState';

const emptyMessage =
  'No matching entries. Adjust the search or choose another kind.';

function teamDirectoryFor(entities: Entity[]): Map<string, PortfolioTeam> {
  const directory = new Map<string, PortfolioTeam>();
  for (const entity of entities) {
    const model = readEntity(entity).value;
    if (model?.category !== 'team') {
      continue;
    }

    const record = model.projection.record;
    const name =
      record && 'name' in record && typeof record.name === 'string'
        ? record.name.trim()
        : '';
    const label = name || entity.metadata.title?.trim() || '';
    if (!label) {
      continue;
    }

    const team: PortfolioTeam = { entity, ref: model.ref, label };
    directory.set(model.ref, team);
    directory.set(sourceKey(model.projection.source), team);
  }
  return directory;
}

async function renderTable(
  kind: PortfolioCategory,
  entities: Entity[],
  teamDirectory: ReadonlyMap<string, PortfolioTeam> = new Map(),
  loading = false,
) {
  return renderInTestApp(
    <PortfolioTable
      kind={kind}
      entities={entities}
      teamDirectory={teamDirectory}
      title={kind}
      loading={loading}
    />,
    {
      mountedRoutes: {
        '/catalog/:namespace/:kind/:name': entityRouteRef,
      },
    },
  );
}

describe('PortfolioTable', () => {
  it('shows a loading table instead of the empty state until the first result arrives', async () => {
    const teamDirectory = new Map<string, PortfolioTeam>();
    const rendered = await renderTable('listing', [], teamDirectory, true);

    expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument();

    rendered.rerender(
      <PortfolioTable
        kind="listing"
        entities={[]}
        teamDirectory={teamDirectory}
        title="Product listings"
        loading={false}
      />,
    );

    expect(screen.getByText(emptyMessage)).toBeInTheDocument();
  });

  it('shows listing columns and uses the repository and team counts', async () => {
    const entities = portfolioFixtures(13);
    const listing = entities.find(
      entity => entity.metadata.name === 'listing-1',
    )!;
    await renderTable('listing', [listing], teamDirectoryFor(entities));

    const row = await screen.findByRole('row', { name: /Listing 1/ });
    expect(row).toHaveTextContent('Short description for listing 1');
    expect(row).toHaveTextContent('team 1');
    expect(row).toHaveTextContent('3');
    expect(row).toHaveTextContent('Published');
    expect(
      screen.getByRole('columnheader', { name: 'Short description' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Repositories' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Published state' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('columnheader', { name: 'Type' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'team 1' })).toHaveAttribute(
      'href',
      '/catalog/pyxis/group/team-1',
    );
    expect(
      document.querySelector(`time[datetime="${observedAt}"]`),
    ).toBeInTheDocument();
  });

  it('shows repository path, team name, and published state', async () => {
    const entities = portfolioFixtures(13);
    const repository = entities.find(
      entity => entity.metadata.name === 'repository-1',
    )!;
    await renderTable('repository', [repository], teamDirectoryFor(entities));

    const row = await screen.findByRole('row', { name: /Repository 1/ });
    expect(row).toHaveTextContent('registry.redhat.io/portfolio/repository-1');
    expect(row).toHaveTextContent('team 1');
    expect(row).toHaveTextContent('Published');
    expect(
      screen.getByRole('columnheader', { name: 'Registry / repository' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('columnheader', { name: 'Short description' }),
    ).not.toBeInTheDocument();
  });

  it('shows team member count and last-updated time', async () => {
    const entities = portfolioFixtures(13);
    const team = entities.find(entity => entity.metadata.name === 'team-1')!;
    await renderTable('team', [team]);

    const row = await screen.findByRole('row', { name: /Team 1/ });
    expect(row).toHaveTextContent('2');
    expect(
      screen.getByRole('columnheader', { name: 'Members' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('columnheader', { name: 'Published state' }),
    ).not.toBeInTheDocument();
    expect(
      document.querySelector(`time[datetime="${observedAt}"]`),
    ).toBeInTheDocument();
  });

  it('sorts by name and paginates the selected kind', async () => {
    const user = userEvent.setup();
    const listings = Array.from({ length: 40 }, (_, index) =>
      fixtureEntity('listing', index + 1),
    );
    await renderTable('listing', listings);

    const initialRows = screen.getAllByRole('row');
    expect(initialRows[1]).toHaveTextContent('Listing 1');
    expect(initialRows).toHaveLength(21);

    await user.click(screen.getByRole('columnheader', { name: /Name/ }));
    await waitFor(() => {
      expect(screen.getAllByRole('row')[1].textContent).not.toBe(
        initialRows[1].textContent,
      );
    });

    const sortedRows = screen
      .getAllByRole('row')
      .slice(1)
      .map(row => row.textContent);
    await user.click(screen.getByRole('button', { name: 'Next table page' }));
    await waitFor(() => {
      expect(
        screen
          .getAllByRole('row')
          .slice(1)
          .map(row => row.textContent),
      ).not.toEqual(sortedRows);
    });
  });
});
