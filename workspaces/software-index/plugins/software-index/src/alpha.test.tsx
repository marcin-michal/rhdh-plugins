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

import type { QueryEntitiesResponse } from '@backstage/catalog-client';
import { InMemoryCatalogClient } from '@backstage/catalog-client/testUtils';
import { coreExtensionData } from '@backstage/frontend-plugin-api';
import {
  createExtensionTester,
  mockApis,
  renderTestApp,
} from '@backstage/frontend-test-utils';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import catalog from '@backstage/plugin-catalog/alpha';
import { PYXIS_ANNOTATIONS } from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
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
import { softwareIndexPage } from './extensions/softwareIndexPage';
import { softwareIndexFixtures } from './testUtils/fixtures';

describe('Software Index NFS wiring', () => {
  it('exports the active page and listing detail extension IDs', () => {
    expect(plugin).toMatchObject({
      $$type: '@backstage/FrontendPlugin',
      id: 'software-index',
    });
    for (const id of [
      'page:software-index',
      'entity-content:software-index/listing-overview',
      'entity-content:software-index/repository-overview',
      'entity-content:software-index/repository-product-listings',
      'entity-content:software-index/listing-repositories',
      'entity-content:software-index/listing-grades',
      'entity-content:software-index/repository-grades',
      'entity-content:software-index/team-overview',
      'entity-content:software-index/team-repositories',
      'entity-content:software-index/team-product-listings',
      'entity-content:software-index/team-grades',
    ] as const) {
      expect(plugin.getExtension(id)).toBeDefined();
    }
  });

  it('binds the dedicated page and listing overview tab paths', () => {
    expect(
      createExtensionTester(softwareIndexPage).get(coreExtensionData.routePath),
    ).toBe('/software-index');
    expect(
      createExtensionTester(softwareIndexPage).get(coreExtensionData.icon),
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

  it.each([
    {
      entityPath: 'resource/listing-1',
      overview: 'Long description for listing 1',
      relatedTabs: [{ title: 'Repositories', row: 'Repository 1' }],
    },
    {
      entityPath: 'resource/repository-1',
      overview: 'Long description for repository 1',
      relatedTabs: [{ title: 'Product listings', row: 'Listing 1' }],
    },
    {
      entityPath: 'group/team-1',
      overview: 'Members',
      relatedTabs: [
        { title: 'Repositories', row: 'Repository 1' },
        { title: 'Product listings', row: 'Listing 1' },
      ],
    },
  ])(
    'mounts and filters the lazy catalog tabs for $entityPath',
    async ({ entityPath, overview, relatedTabs }) => {
      const user = userEvent.setup();
      const entities = softwareIndexFixtures(13);
      for (const entity of entities) {
        delete entity.metadata.annotations?.[PYXIS_ANNOTATIONS.sourceInstance];
      }
      const catalogApi = new InMemoryCatalogClient({ entities });
      renderTestApp({
        features: [catalog, plugin],
        initialRouteEntries: [`/catalog/pyxis/${entityPath}`],
        apis: [[catalogApiRef, catalogApi], mockApis.permission()],
        config: {
          app: {
            extensions: [
              {
                'entity-content:catalog/overview': {
                  config: {
                    filter: {
                      $not: {
                        'metadata.namespace': 'pyxis',
                        [`metadata.annotations.${PYXIS_ANNOTATIONS.sourceKind}`]:
                          { $in: ['listing', 'repository', 'team', 'user'] },
                      },
                    },
                  },
                },
              },
            ],
          },
        },
      });

      expect(await screen.findByText(overview)).toBeVisible();
      expect(
        screen.getAllByRole('tab', {
          name: /^(Repositories|Product listings)$/,
        }),
      ).toHaveLength(relatedTabs.length);
      for (const { title, row } of relatedTabs) {
        await user.click(screen.getByRole('tab', { name: title }));
        expect(
          await screen.findByRole('rowheader', { name: row }),
        ).toBeVisible();
      }

      await user.click(screen.getByRole('tab', { name: 'Grades' }));
      expect(
        await screen.findByRole('heading', { name: 'Container Health Index' }),
      ).toBeVisible();
    },
  );

  it('mounts the lazy page in a real NFS test app with a scoped catalog request', async () => {
    const catalogApi = new InMemoryCatalogClient();
    const queryEntities = jest.spyOn(catalogApi, 'queryEntities');
    renderTestApp({
      features: [catalog, plugin],
      initialRouteEntries: ['/software-index'],
      apis: [[catalogApiRef, catalogApi]],
    });

    await waitFor(() =>
      expect(
        screen.getByText(
          'No matching entries. Adjust the search or choose another kind.',
        ),
      ).toBeInTheDocument(),
    );
    expect(queryEntities).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: expect.objectContaining({
          'metadata.namespace': 'pyxis',
          [`metadata.annotations.${PYXIS_ANNOTATIONS.sourceKind}`]: 'listing',
        }),
        limit: 20,
        offset: 0,
      }),
    );
  });

  it('keeps the empty state hidden while the scoped catalog request is pending', async () => {
    let resolveEntities!: (response: QueryEntitiesResponse) => void;
    const pendingEntities = new Promise<QueryEntitiesResponse>(resolve => {
      resolveEntities = resolve;
    });
    const catalogApi = new InMemoryCatalogClient();
    const queryEntities = jest
      .spyOn(catalogApi, 'queryEntities')
      .mockReturnValueOnce(pendingEntities);

    renderTestApp({
      features: [catalog, plugin],
      initialRouteEntries: ['/software-index'],
      apis: [[catalogApiRef, catalogApi]],
    });

    await waitFor(() => expect(queryEntities).toHaveBeenCalled());
    expect(screen.getByRole('grid')).toHaveAttribute('data-loading', 'true');
    expect(
      screen.queryByText(
        'No matching entries. Adjust the search or choose another kind.',
      ),
    ).not.toBeInTheDocument();

    await act(async () => {
      resolveEntities({ items: [], totalItems: 0, pageInfo: {} });
    });

    expect(
      await screen.findByText(
        'No matching entries. Adjust the search or choose another kind.',
      ),
    ).toBeInTheDocument();
  });

  it('lists managed entity kinds and filters rows by kind and name', async () => {
    const user = userEvent.setup();
    const catalogApi = new InMemoryCatalogClient({
      entities: softwareIndexFixtures(13),
    });
    const queryEntities = jest.spyOn(catalogApi, 'queryEntities');
    renderTestApp({
      features: [catalog, plugin],
      initialRouteEntries: ['/software-index'],
      apis: [[catalogApiRef, catalogApi]],
    });

    expect(await screen.findByText('Listing 1')).toBeInTheDocument();
    expect(screen.queryByText('Repository 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Team 1')).not.toBeInTheDocument();
    expect(screen.queryByText('User 1')).not.toBeInTheDocument();

    expect(
      screen.queryByRole('radio', { name: /All entries/ }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Repositories/ }));
    expect(await screen.findByText('Repository 1')).toBeInTheDocument();
    expect(screen.queryByText('Listing 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Team 1')).not.toBeInTheDocument();

    await user.type(
      screen.getByRole('textbox', { name: 'Search by name' }),
      'repository-1',
    );
    await waitFor(() =>
      expect(screen.queryByText('Repository 2')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Repository 1')).toBeInTheDocument();
    expect(queryEntities).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filter: expect.objectContaining({
          [`metadata.annotations.${PYXIS_ANNOTATIONS.sourceKind}`]:
            'repository',
        }),
        offset: 0,
        fullTextFilter: expect.objectContaining({ term: 'repository-1' }),
      }),
    );

    await user.clear(screen.getByRole('textbox', { name: 'Search by name' }));
    await user.click(screen.getByRole('radio', { name: /Teams/ }));
    expect(await screen.findByText('Team 1')).toBeInTheDocument();
    expect(screen.queryByText('Repository 1')).not.toBeInTheDocument();
  });
});
