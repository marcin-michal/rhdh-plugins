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

import { stringifyEntityRef } from '@backstage/catalog-model';
import { InMemoryCatalogClient } from '@backstage/catalog-client/testUtils';
import {
  catalogApiRef,
  EntityProvider,
  entityRouteRef,
} from '@backstage/plugin-catalog-react';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import type {
  PyxisProjection,
  SourceListing,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import {
  fixtureEntity,
  observedAt,
  softwareIndexFixtures,
} from '../../testUtils/fixtures';
import { ListingOverview } from './Overview';

function CurrentLocation() {
  const { pathname, search } = useLocation();
  return <output data-testid="current-location">{pathname + search}</output>;
}

describe('ListingOverview', () => {
  it('renders listing details and aggregate repository grade information', async () => {
    const entities = softwareIndexFixtures(13);
    const listing = entities.find(
      entity => entity.metadata.name === 'listing-1',
    )!;
    const entitiesByRef = new Map(
      entities.map(entity => [stringifyEntityRef(entity), entity]),
    );
    const getEntitiesByRefs = jest.fn(
      async ({ entityRefs }: { entityRefs: string[] }) => ({
        items: entityRefs.map(ref => entitiesByRef.get(ref)),
      }),
    );

    await renderInTestApp(
      <TestApiProvider apis={[[catalogApiRef, { getEntitiesByRefs }]]}>
        <EntityProvider entity={listing}>
          <ListingOverview />
        </EntityProvider>
      </TestApiProvider>,
      {
        mountedRoutes: {
          '/catalog/:namespace/:kind/:name': entityRouteRef,
        },
      },
    );

    expect(
      await screen.findByText('Long description for listing 1'),
    ).toBeInTheDocument();
    expect(screen.getByText(/team 1/i)).toBeInTheDocument();
    expect(screen.getByText('Team', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Published')).toBeInTheDocument();
    expect(screen.getByText('Pyxis ID')).toBeInTheDocument();
    expect(
      screen.getByText(
        (listing.spec!.pyxis as unknown as PyxisProjection).source.id,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Latest grade observation')).toBeInTheDocument();
    expect(screen.queryByText('Observation status')).not.toBeInTheDocument();
    expect(screen.queryByText('Incomplete')).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        'These grade counts are based on incomplete repository observations.',
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Some related catalog data is unavailable.'),
    ).not.toBeInTheDocument();
    expect(
      document.querySelector(`time[datetime="${observedAt}"]`),
    ).toBeInTheDocument();
    expect(await screen.findByText('A', { exact: true })).toBeInTheDocument();
    expect(getEntitiesByRefs).toHaveBeenCalled();
  });

  it('reports an entity category mismatch instead of rendering listing details', async () => {
    await renderInTestApp(
      <EntityProvider entity={fixtureEntity('repository')}>
        <ListingOverview />
      </EntityProvider>,
    );

    expect(
      screen.getByText('Managed entity category mismatch.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('No long description is available.'),
    ).not.toBeInTheDocument();
  });

  it('renders support contacts and falls back to the catalog description and owner link', async () => {
    const listing = fixtureEntity('listing');
    const projection = listing.spec!.pyxis as unknown as PyxisProjection;
    const support = {
      description: 'Open a support case for this product.',
      url: 'https://support.example.com/product',
      email_address: 'support@example.com',
      phone_number: '+12025550123',
    } satisfies NonNullable<SourceListing['support']>;
    projection.record = {
      _id: projection.source.id,
      descriptions: { long: ' ', short: '' },
      contacts: [{ type: ' ', email_address: null }],
      support,
    };
    listing.metadata.description = 'Description from the catalog.';
    listing.spec!.owner = 'group:pyxis/team-1';

    await renderInTestApp(
      <TestApiProvider apis={[[catalogApiRef, new InMemoryCatalogClient()]]}>
        <EntityProvider entity={listing}>
          <ListingOverview />
        </EntityProvider>
      </TestApiProvider>,
      { mountedRoutes: { '/catalog/:namespace/:kind/:name': entityRouteRef } },
    );

    expect(screen.getByText(listing.metadata.description)).toBeVisible();
    expect(screen.getByText(support.description)).toBeVisible();
    expect(
      screen.getByText('No contacts are listed for this product.'),
    ).toBeVisible();
    for (const [name, href] of [
      [support.url, support.url],
      [support.email_address, `mailto:${support.email_address}`],
      [support.phone_number, `tel:${support.phone_number}`],
      ['group:pyxis/team-1', '/catalog/pyxis/group/team-1'],
    ]) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
    }
  });

  it('shows the short description and support email when the long description and website are missing', async () => {
    const listing = fixtureEntity('listing');
    const projection = listing.spec!.pyxis as unknown as PyxisProjection;
    projection.record = {
      _id: projection.source.id,
      descriptions: { short: 'Product summary' },
      support: { url: null, email_address: 'support@example.com' },
    };

    await renderInTestApp(
      <TestApiProvider apis={[[catalogApiRef, new InMemoryCatalogClient()]]}>
        <EntityProvider entity={listing}>
          <ListingOverview />
        </EntityProvider>
      </TestApiProvider>,
      { mountedRoutes: { '/catalog/:namespace/:kind/:name': entityRouteRef } },
    );

    expect(screen.getByText('Product summary')).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'support@example.com' }),
    ).toHaveAttribute('href', 'mailto:support@example.com');
    expect(screen.queryByText('Support website')).not.toBeInTheDocument();
  });

  it('opens the matching grade section on the Grades tab from a grade row', async () => {
    const user = userEvent.setup();
    const entities = softwareIndexFixtures(13);
    const listing = entities.find(
      entity => entity.metadata.name === 'listing-1',
    )!;
    const entitiesByRef = new Map(
      entities.map(entity => [stringifyEntityRef(entity), entity]),
    );
    const getEntitiesByRefs = jest.fn(
      async ({ entityRefs }: { entityRefs: string[] }) => ({
        items: entityRefs.map(ref => entitiesByRef.get(ref)),
      }),
    );

    await renderInTestApp(
      <TestApiProvider apis={[[catalogApiRef, { getEntitiesByRefs }]]}>
        <EntityProvider entity={listing}>
          <ListingOverview />
        </EntityProvider>
        <CurrentLocation />
      </TestApiProvider>,
      {
        routeEntries: ['/catalog/pyxis/resource/listing-1'],
        mountedRoutes: {
          '/catalog/:namespace/:kind/:name': entityRouteRef,
        },
      },
    );

    const gradeHeader = await screen.findByRole('rowheader', { name: 'A' });
    await user.click(gradeHeader);

    await waitFor(() => {
      expect(screen.getByTestId('current-location')).toHaveTextContent(
        '/catalog/pyxis/resource/listing-1/grades?grade=a',
      );
    });
  });
});
