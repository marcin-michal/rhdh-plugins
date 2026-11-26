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
import type { QueryEntitiesResponse } from '@backstage/catalog-client';
import { InMemoryCatalogClient } from '@backstage/catalog-client/testUtils';
import { catalogApiRef, entityRouteRef } from '@backstage/plugin-catalog-react';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  PYXIS_ANNOTATIONS,
  type PyxisProjection,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import {
  fixtureEntity,
  observedAt,
  softwareIndexFixtures,
} from '../testUtils/fixtures';
import { SoftwareIndexTable } from './SoftwareIndexTable';
import type { SoftwareIndexCategory } from './filterState';

const emptyMessage =
  'No matching entries. Adjust the search or choose another kind.';

async function renderTable(
  kind: SoftwareIndexCategory,
  entities: Entity[],
  catalogApi = new InMemoryCatalogClient({ entities }),
) {
  const queryEntities = jest.spyOn(catalogApi, 'queryEntities');
  const streamEntities = jest.spyOn(catalogApi, 'streamEntities');
  await renderInTestApp(
    <TestApiProvider apis={[[catalogApiRef, catalogApi]]}>
      <SoftwareIndexTable kind={kind} search="" title={kind} />
    </TestApiProvider>,
    {
      mountedRoutes: {
        '/catalog/:namespace/:kind/:name': entityRouteRef,
      },
    },
  );
  return { queryEntities, streamEntities };
}

describe('SoftwareIndexTable', () => {
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

  it('recovers the results after a catalog query fails', async () => {
    const user = userEvent.setup();
    const team = fixtureEntity('team');
    const catalogApi = new InMemoryCatalogClient({ entities: [team] });
    jest
      .spyOn(catalogApi, 'queryEntities')
      .mockRejectedValueOnce(new Error('Catalog unavailable'));

    await renderTable('team', [], catalogApi);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to load Software Index catalog data.',
    );
    expect(screen.queryByText(emptyMessage)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('link', { name: 'Team 1' })).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    [1, '1 catalog entity does'],
    [2, '2 catalog entities do'],
  ])(
    'reports %i invalid catalog rows alongside valid results',
    async (count, warning) => {
      const malformed = Array.from({ length: count }, (_, index) => {
        const listing = fixtureEntity('listing', index + 2);
        listing.spec!.pyxis = { version: '2' };
        return listing;
      });

      await renderTable('listing', [fixtureEntity('listing'), ...malformed]);

      expect(await screen.findByRole('alert')).toHaveTextContent(
        `${warning} not match the Pyxis catalog schema for this view.`,
      );
      expect(screen.getByRole('row', { name: 'Listing 1' })).toHaveTextContent(
        'Published',
      );
      for (const listing of malformed) {
        expect(
          screen.getByRole('row', { name: listing.metadata.title }),
        ).toHaveTextContent('Unknown');
      }
    },
  );

  it.each(['listing', 'repository'] as const)(
    'shows %s rows while the team directory is loading',
    async kind => {
      const owned = fixtureEntity(kind);
      const unowned = fixtureEntity(kind, 2);
      const team = fixtureEntity('team');
      owned.relations = [
        { type: 'ownedBy', targetRef: stringifyEntityRef(team) },
      ];
      const catalogApi = new InMemoryCatalogClient({
        entities: [owned, unowned],
      });
      let resolveTeams!: (teams: Entity[]) => void;
      const pendingTeams = new Promise<Entity[]>(resolve => {
        resolveTeams = resolve;
      });
      jest
        .spyOn(catalogApi, 'streamEntities')
        .mockImplementationOnce(async function* streamTeams() {
          yield await pendingTeams;
        });

      const { queryEntities, streamEntities } = await renderTable(
        kind,
        [],
        catalogApi,
      );
      expect(
        await screen.findByRole('link', { name: owned.metadata.title }),
      ).toBeVisible();
      const ownedRow = screen.getByRole('row', {
        name: new RegExp(owned.metadata.title!),
      });
      const unownedRow = screen.getByRole('row', {
        name: new RegExp(unowned.metadata.title!),
      });
      expect(
        within(ownedRow).getByRole('progressbar', {
          name: 'Loading team names',
        }),
      ).toBeVisible();
      expect(within(unownedRow).getByText('—')).toBeVisible();
      expect(
        within(unownedRow).queryByLabelText('Loading team names'),
      ).not.toBeInTheDocument();

      await act(async () => resolveTeams([team]));
      expect(
        await screen.findByRole('link', { name: 'team 1' }),
      ).toHaveAttribute('href', '/catalog/pyxis/group/team-1');
      expect(
        screen.queryByLabelText('Loading team names'),
      ).not.toBeInTheDocument();
      expect(queryEntities).toHaveBeenCalledTimes(1);
      expect(streamEntities).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps listings visible when team loading fails and retries just the directory', async () => {
    const user = userEvent.setup();
    const catalogApi = new InMemoryCatalogClient({
      entities: softwareIndexFixtures(13),
    });
    jest.spyOn(catalogApi, 'streamEntities').mockImplementationOnce(() => {
      throw new Error('Catalog unavailable');
    });
    const { queryEntities, streamEntities } = await renderTable(
      'listing',
      [],
      catalogApi,
    );

    expect(
      await screen.findByRole('link', { name: 'Listing 1' }),
    ).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Team names could not be loaded.',
    );
    expect(
      screen.queryByLabelText('Loading team names'),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry team names' }));

    expect(await screen.findByRole('link', { name: 'team 1' })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(streamEntities).toHaveBeenCalledTimes(2);
    expect(
      queryEntities.mock.calls.filter(
        ([request]) => request && 'offset' in request,
      ),
    ).toHaveLength(1);
  });

  it('shows listing columns and uses the repository and team counts', async () => {
    const entities = softwareIndexFixtures(13);
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
    const entities = softwareIndexFixtures(13);
    await renderTable('repository', entities);

    const row = await screen.findByRole('row', { name: /Repository 1/ });
    expect(row).toHaveTextContent(
      'registry.redhat.io/software-index/repository-1',
    );
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
    const entities = softwareIndexFixtures(13);
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
    delete teams[200].metadata.annotations![PYXIS_ANNOTATIONS.sourceInstance];
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
          `metadata.annotations.${PYXIS_ANNOTATIONS.sourceId}`,
          `metadata.annotations.${PYXIS_ANNOTATIONS.projectionVersion}`,
          'spec.type',
          'spec.pyxis.source.sourceInstance',
          'spec.pyxis.record.name',
        ],
      }),
    );
  });

  it('paginates the selected kind in catalog response order', async () => {
    const user = userEvent.setup();
    const listings = Array.from({ length: 40 }, (_, index) =>
      fixtureEntity('listing', 40 - index),
    );
    const { queryEntities, streamEntities } = await renderTable(
      'listing',
      listings,
    );
    const filter = {
      'metadata.namespace': 'pyxis',
      [`metadata.annotations.${PYXIS_ANNOTATIONS.sourceKind}`]: 'listing',
    };
    expect(
      await screen.findByRole('link', { name: 'Listing 40' }),
    ).toBeVisible();
    expect(screen.getAllByRole('row')).toHaveLength(21);
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Listing 40');
    expect(
      screen.getByRole('columnheader', { name: 'Name' }),
    ).not.toHaveAttribute('aria-sort');
    expect(queryEntities).toHaveBeenCalledWith(
      expect.objectContaining({ filter, limit: 20, offset: 0 }),
    );

    await user.click(screen.getByRole('button', { name: 'Next table page' }));
    expect(
      await screen.findByRole('link', { name: 'Listing 20' }),
    ).toBeVisible();
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Listing 20');
    expect(queryEntities).toHaveBeenLastCalledWith(
      expect.objectContaining({ filter, limit: 20, offset: 20 }),
    );
    for (const [request] of queryEntities.mock.calls) {
      expect(request).not.toHaveProperty('orderFields');
    }
    expect(streamEntities).toHaveBeenCalledTimes(1);
  });
});
