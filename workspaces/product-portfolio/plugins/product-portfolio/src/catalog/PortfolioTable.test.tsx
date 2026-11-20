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
import type { QueryEntitiesResponse } from '@backstage/catalog-client';
import { InMemoryCatalogClient } from '@backstage/catalog-client/testUtils';
import {
  CATALOG_FILTER_EXISTS,
  catalogApiRef,
  entityRouteRef,
} from '@backstage/plugin-catalog-react';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  PYXIS_ANNOTATIONS,
  type PyxisProjection,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import {
  fixtureEntity,
  observedAt,
  portfolioFixtures,
} from '../testUtils/fixtures';
import { PortfolioTable } from './PortfolioTable';
import type { PortfolioCategory } from './filterState';

const emptyMessage =
  'No matching entries. Adjust the search or choose another kind.';

async function renderTable(
  kind: PortfolioCategory,
  entities: Entity[],
  catalogApi = new InMemoryCatalogClient({ entities }),
) {
  const queryEntities = jest.spyOn(catalogApi, 'queryEntities');
  const streamEntities = jest.spyOn(catalogApi, 'streamEntities');
  await renderInTestApp(
    <TestApiProvider apis={[[catalogApiRef, catalogApi]]}>
      <PortfolioTable kind={kind} search="" title={kind} />
    </TestApiProvider>,
    {
      mountedRoutes: {
        '/catalog/:namespace/:kind/:name': entityRouteRef,
      },
    },
  );
  return { queryEntities, streamEntities };
}

describe('PortfolioTable', () => {
  it('shows a loading table instead of the empty state until the first result arrives', async () => {
    let resolveQuery!: (response: QueryEntitiesResponse) => void;
    const pendingResponse = new Promise<QueryEntitiesResponse>(resolve => {
      resolveQuery = resolve;
    });
    const catalogApi = new InMemoryCatalogClient();
    jest
      .spyOn(catalogApi, 'queryEntities')
      .mockReturnValueOnce(pendingResponse);

    await renderTable('listing', [], catalogApi);
    expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument();

    await act(async () => {
      resolveQuery({ items: [], totalItems: 0, pageInfo: {} });
    });
    expect(await screen.findByText(emptyMessage)).toBeInTheDocument();
  });

  it('shows listing columns and uses the repository and team counts', async () => {
    const entities = portfolioFixtures(13);
    await renderTable('listing', entities);

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
    await renderTable('repository', entities);

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
    const { queryEntities, streamEntities } = await renderTable(
      'team',
      entities,
    );

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
    expect(queryEntities).toHaveBeenCalledTimes(1);
    expect(streamEntities).not.toHaveBeenCalled();
  });

  it('resolves an owner by source ID from a later page of the projected team directory', async () => {
    const listing = fixtureEntity('listing');
    const teams = Array.from({ length: 201 }, (_, index) =>
      fixtureEntity('team', index + 1),
    );
    const projection = listing.spec!.pyxis as unknown as PyxisProjection;
    Object.assign(projection.record!, {
      team_id: teams[200].metadata.annotations![PYXIS_ANNOTATIONS.sourceId],
    });
    const { queryEntities, streamEntities } = await renderTable('listing', [
      listing,
      ...teams,
    ]);

    expect(
      await screen.findByRole('link', { name: 'team 201' }),
    ).toHaveAttribute('href', '/catalog/pyxis/group/team-201');
    expect(streamEntities).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: {
          'metadata.namespace': 'pyxis',
          [`metadata.annotations.${PYXIS_ANNOTATIONS.sourceInstance}`]:
            CATALOG_FILTER_EXISTS,
          [`metadata.annotations.${PYXIS_ANNOTATIONS.sourceKind}`]: 'team',
        },
      }),
    );
    expect(queryEntities).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: expect.any(String),
        limit: 200,
        fields: [
          'kind',
          'metadata.name',
          'metadata.namespace',
          'metadata.title',
          `metadata.annotations.${PYXIS_ANNOTATIONS.sourceInstance}`,
          `metadata.annotations.${PYXIS_ANNOTATIONS.sourceId}`,
          `metadata.annotations.${PYXIS_ANNOTATIONS.projectionVersion}`,
          'spec.type',
          'spec.pyxis.record.name',
        ],
      }),
    );
  });

  it('sorts by name and paginates the selected kind', async () => {
    const user = userEvent.setup();
    const listings = Array.from({ length: 40 }, (_, index) => {
      const listing = fixtureEntity('listing', index + 1);
      listing.metadata.title = `Listing ${String(index + 1).padStart(2, '0')}`;
      return listing;
    });
    const catalogApi = new InMemoryCatalogClient({ entities: listings });
    const queryCatalog = catalogApi.queryEntities.bind(catalogApi);
    const { queryEntities, streamEntities } = await renderTable(
      'listing',
      [],
      catalogApi,
    );
    const filter = expect.objectContaining({
      'metadata.namespace': 'pyxis',
      [`metadata.annotations.${PYXIS_ANNOTATIONS.sourceKind}`]: 'listing',
    });
    expect(
      await screen.findByRole('link', { name: 'Listing 01' }),
    ).toBeVisible();
    expect(screen.getAllByRole('row')).toHaveLength(21);
    expect(queryEntities).toHaveBeenCalledWith(
      expect.objectContaining({ filter, limit: 20, offset: 0 }),
    );

    let releaseSortedPage!: () => void;
    const sortedPagePending = new Promise<void>(resolve => {
      releaseSortedPage = resolve;
    });
    queryEntities.mockImplementationOnce(async request => {
      await sortedPagePending;
      return queryCatalog(request);
    });
    await user.click(screen.getByRole('columnheader', { name: /Name/ }));
    await waitFor(() =>
      expect(queryEntities).toHaveBeenLastCalledWith(
        expect.objectContaining({
          orderFields: { field: 'metadata.title', order: 'desc' },
        }),
      ),
    );
    await act(async () => releaseSortedPage());
    expect(
      await screen.findByRole('link', { name: 'Listing 40' }),
    ).toBeVisible();
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Listing 40');
    await user.click(screen.getByRole('button', { name: 'Next table page' }));
    expect(
      await screen.findByRole('link', { name: 'Listing 20' }),
    ).toBeVisible();
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Listing 20');
    expect(queryEntities).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filter,
        limit: 20,
        offset: 20,
        orderFields: { field: 'metadata.title', order: 'desc' },
      }),
    );
    expect(streamEntities).toHaveBeenCalledTimes(1);
  });
});
