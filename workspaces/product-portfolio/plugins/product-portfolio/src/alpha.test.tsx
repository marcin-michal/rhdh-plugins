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

import { coreExtensionData } from '@backstage/frontend-plugin-api';
import {
  createExtensionTester,
  renderTestApp,
} from '@backstage/frontend-test-utils';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import catalog from '@backstage/plugin-catalog/alpha';
import plugin from './alpha';
import { listingOverview } from './extensions/listingOverview';
import { repositoryOverview } from './extensions/repositoryOverview';
import { listingRepositories } from './extensions/listingRepositories';
import { listingGrades } from './extensions/listingGrades';
import { repositoryGrades } from './extensions/repositoryGrades';
import { repositoryProductListings } from './extensions/repositoryProductListings';
import { teamOverview } from './extensions/teamOverview';
import { teamRepositories } from './extensions/teamRepositories';
import { teamProductListings } from './extensions/teamProductListings';
import { teamGrades } from './extensions/teamGrades';
import { portfolioPage } from './extensions/portfolioPage';
import { portfolioFixtures } from './testUtils/fixtures';

describe('portfolio NFS wiring', () => {
  it('exports the active page and listing detail extension IDs', () => {
    expect(plugin).toMatchObject({
      $$type: '@backstage/FrontendPlugin',
      id: 'product-portfolio',
    });
    for (const id of [
      'page:product-portfolio',
      'entity-content:product-portfolio/listing-overview',
      'entity-content:product-portfolio/repository-overview',
      'entity-content:product-portfolio/repository-product-listings',
      'entity-content:product-portfolio/listing-repositories',
      'entity-content:product-portfolio/listing-grades',
      'entity-content:product-portfolio/repository-grades',
      'entity-content:product-portfolio/team-overview',
      'entity-content:product-portfolio/team-repositories',
      'entity-content:product-portfolio/team-product-listings',
      'entity-content:product-portfolio/team-grades',
    ] as const) {
      expect(plugin.getExtension(id)).toBeDefined();
    }
  });

  it('binds the dedicated page and listing overview tab paths', () => {
    expect(
      createExtensionTester(portfolioPage).get(coreExtensionData.routePath),
    ).toBe('/product-portfolio');
    expect(
      createExtensionTester(portfolioPage).get(coreExtensionData.icon),
    ).toBeDefined();
    expect(
      createExtensionTester(listingOverview).get(coreExtensionData.routePath),
    ).toBe('/');
    expect(
      createExtensionTester(repositoryOverview).get(
        coreExtensionData.routePath,
      ),
    ).toBe('/');
    expect(
      createExtensionTester(listingRepositories).get(
        coreExtensionData.routePath,
      ),
    ).toBe('/repositories');
    expect(
      createExtensionTester(repositoryProductListings).get(
        coreExtensionData.routePath,
      ),
    ).toBe('/product-listings');
    expect(
      createExtensionTester(listingGrades).get(coreExtensionData.routePath),
    ).toBe('/grades');
    expect(
      createExtensionTester(repositoryGrades).get(coreExtensionData.routePath),
    ).toBe('/grades');
    expect(
      createExtensionTester(teamOverview).get(coreExtensionData.routePath),
    ).toBe('/');
    expect(
      createExtensionTester(teamRepositories).get(coreExtensionData.routePath),
    ).toBe('/repositories');
    expect(
      createExtensionTester(teamProductListings).get(
        coreExtensionData.routePath,
      ),
    ).toBe('/product-listings');
    expect(
      createExtensionTester(teamGrades).get(coreExtensionData.routePath),
    ).toBe('/grades');
  });

  it('mounts the lazy page in a real NFS test app with a scoped catalog request', async () => {
    const getEntities = jest.fn(async () => ({ items: [] }));
    renderTestApp({
      features: [catalog, plugin],
      initialRouteEntries: ['/product-portfolio'],
      apis: [[catalogApiRef, { getEntities }]],
    });

    await waitFor(() =>
      expect(
        screen.getByText(
          'No matching entries. Adjust the search or choose another type.',
        ),
      ).toBeInTheDocument(),
    );
    expect(getEntities).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: expect.objectContaining({ 'metadata.namespace': 'pyxis' }),
      }),
    );
  });

  it('keeps the empty state hidden while the scoped catalog request is pending', async () => {
    let resolveEntities!: (response: {
      items: ReturnType<typeof portfolioFixtures>;
    }) => void;
    const pendingEntities = new Promise<{
      items: ReturnType<typeof portfolioFixtures>;
    }>(resolve => {
      resolveEntities = resolve;
    });
    const getEntities = jest.fn(() => pendingEntities);

    renderTestApp({
      features: [catalog, plugin],
      initialRouteEntries: ['/product-portfolio'],
      apis: [[catalogApiRef, { getEntities }]],
    });

    await waitFor(() => expect(getEntities).toHaveBeenCalled());
    expect(
      screen.getByText('Loading product portfolio entries…'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        'No matching entries. Adjust the search or choose another type.',
      ),
    ).not.toBeInTheDocument();

    await act(async () => {
      resolveEntities({ items: portfolioFixtures(13) });
    });

    expect(await screen.findByText('Listing 1')).toBeInTheDocument();
    expect(
      screen.queryByText('Loading product portfolio entries…'),
    ).not.toBeInTheDocument();
  });

  it('lists managed entity kinds and filters rows by kind and name', async () => {
    const user = userEvent.setup();
    const getEntities = jest.fn(async () => ({ items: portfolioFixtures(13) }));
    renderTestApp({
      features: [catalog, plugin],
      initialRouteEntries: ['/product-portfolio'],
      apis: [[catalogApiRef, { getEntities }]],
    });

    expect(await screen.findByText('Listing 1')).toBeInTheDocument();
    expect(screen.getByText('Repository 1')).toBeInTheDocument();
    expect(screen.getByText('Team 1')).toBeInTheDocument();
    expect(screen.queryByText('User 1')).not.toBeInTheDocument();

    await user.click(screen.getByText('Repositories'));
    await waitFor(() =>
      expect(screen.queryByText('Listing 1')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Repository 1')).toBeInTheDocument();

    await user.type(
      screen.getByRole('textbox', { name: 'Search by name' }),
      'repository-1',
    );
    await waitFor(() =>
      expect(screen.queryByText('Repository 2')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Repository 1')).toBeInTheDocument();
  });
});
