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
import { readEntity } from '../model/entities';
import { portfolioFixtures } from '../testUtils/fixtures';
import { PortfolioTable } from './PortfolioTable';

const emptyMessage =
  'No matching entries. Adjust the search or choose another type.';

async function renderTable(entities: Entity[], loading = false) {
  return renderInTestApp(
    <PortfolioTable
      entities={entities}
      teamLabels={new Map()}
      title="Product portfolio"
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
    const rendered = await renderTable([], true);

    expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument();

    rendered.rerender(
      <PortfolioTable
        entities={[]}
        teamLabels={new Map()}
        title="Product portfolio"
        loading={false}
      />,
    );

    expect(screen.getByText(emptyMessage)).toBeInTheDocument();
  });

  it('sorts by name and paginates managed entities', async () => {
    const user = userEvent.setup();
    const managedEntities = portfolioFixtures(40).filter(entity => {
      const category = readEntity(entity).value?.category;
      return (
        category === 'listing' ||
        category === 'repository' ||
        category === 'team'
      );
    });
    await renderTable(managedEntities);

    const firstPageRows = screen.getAllByRole('row');
    expect(firstPageRows[1]).toHaveTextContent('Listing 1');
    expect(firstPageRows).toHaveLength(21);
    expect(screen.queryByText('Team 1')).not.toBeInTheDocument();

    await user.click(screen.getByRole('columnheader', { name: /Name/ }));
    await waitFor(() =>
      expect(screen.getAllByRole('row')[1]).toHaveTextContent('Team 2'),
    );

    await user.click(screen.getByRole('button', { name: 'Next table page' }));
    expect(await screen.findByText('Listing 1')).toBeInTheDocument();
  });
});
