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

import {
  createComponentExtension,
  createPlugin,
  createRoutableExtension,
} from '@backstage/core-plugin-api';
import type { ComponentType } from 'react';
import { rootRouteRef } from './legacyRoutes';

/** Classic frontend plugin entry point. @public */
export const softwareIndexPlugin = createPlugin({
  id: 'software-index',
  routes: { root: rootRouteRef },
});

/** Classic route wrapper for the shared Software Index page. @public */
export const SoftwareIndexPageExtension: ComponentType =
  softwareIndexPlugin.provide(
    createRoutableExtension({
      name: 'SoftwareIndexPageExtension',
      component: () =>
        import('./catalog/SoftwareIndexPage').then(m => m.SoftwareIndexPage),
      mountPoint: rootRouteRef,
    }),
  );

/** Classic entity overview for Pyxis listings. @public */
export const SoftwareIndexListingOverview: ComponentType =
  softwareIndexPlugin.provide(
    createComponentExtension({
      name: 'SoftwareIndexListingOverview',
      component: {
        lazy: () =>
          import('./components/product-listing/Overview').then(
            m => m.ListingOverview,
          ),
      },
    }),
  );

/** Classic repositories tab for Pyxis listings. @public */
export const SoftwareIndexListingRepositories: ComponentType =
  softwareIndexPlugin.provide(
    createComponentExtension({
      name: 'SoftwareIndexListingRepositories',
      component: {
        lazy: () =>
          import('./components/product-listing/Repositories').then(
            m => m.ListingRepositories,
          ),
      },
    }),
  );

/** Classic entity overview for Pyxis repositories. @public */
export const SoftwareIndexRepositoryOverview: ComponentType =
  softwareIndexPlugin.provide(
    createComponentExtension({
      name: 'SoftwareIndexRepositoryOverview',
      component: {
        lazy: () =>
          import('./components/repository/Overview').then(
            m => m.RepositoryOverview,
          ),
      },
    }),
  );

/** Classic product listings tab for Pyxis repositories. @public */
export const SoftwareIndexRepositoryProductListings: ComponentType =
  softwareIndexPlugin.provide(
    createComponentExtension({
      name: 'SoftwareIndexRepositoryProductListings',
      component: {
        lazy: () =>
          import('./components/repository/ProductListings').then(
            m => m.RepositoryProductListings,
          ),
      },
    }),
  );

/** Classic entity overview for Pyxis teams. @public */
export const SoftwareIndexTeamOverview: ComponentType =
  softwareIndexPlugin.provide(
    createComponentExtension({
      name: 'SoftwareIndexTeamOverview',
      component: {
        lazy: () =>
          import('./components/team/Overview').then(m => m.TeamOverview),
      },
    }),
  );

/** Classic repositories tab for Pyxis teams. @public */
export const SoftwareIndexTeamRepositories: ComponentType =
  softwareIndexPlugin.provide(
    createComponentExtension({
      name: 'SoftwareIndexTeamRepositories',
      component: {
        lazy: () =>
          import('./components/team/Repositories').then(
            m => m.TeamRepositories,
          ),
      },
    }),
  );

/** Classic product listings tab for Pyxis teams. @public */
export const SoftwareIndexTeamProductListings: ComponentType =
  softwareIndexPlugin.provide(
    createComponentExtension({
      name: 'SoftwareIndexTeamProductListings',
      component: {
        lazy: () =>
          import('./components/team/ProductListings').then(
            m => m.TeamProductListings,
          ),
      },
    }),
  );

/** Classic Grades tab; the component selects the view from the current entity. @public */
export const SoftwareIndexGrades: ComponentType = softwareIndexPlugin.provide(
  createComponentExtension({
    name: 'SoftwareIndexGrades',
    component: {
      lazy: () => import('./components/grades/Grades').then(m => m.Grades),
    },
  }),
);
