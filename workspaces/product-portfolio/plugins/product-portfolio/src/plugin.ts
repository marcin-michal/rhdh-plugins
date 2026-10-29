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
export const productPortfolioPlugin = createPlugin({
  id: 'product-portfolio',
  routes: { root: rootRouteRef },
});

/** Classic route wrapper for the shared Product Portfolio page. @public */
export const ProductPortfolioPageExtension: ComponentType =
  productPortfolioPlugin.provide(
    createRoutableExtension({
      name: 'ProductPortfolioPageExtension',
      component: () =>
        import('./catalog/ProductPortfolioPage').then(
          m => m.ProductPortfolioPage,
        ),
      mountPoint: rootRouteRef,
    }),
  );

/** Classic entity overview for Pyxis listings. @public */
export const ProductPortfolioListingOverview: ComponentType =
  productPortfolioPlugin.provide(
    createComponentExtension({
      name: 'ProductPortfolioListingOverview',
      component: {
        lazy: () =>
          import('./components/product-listing/Overview').then(
            m => m.ListingOverview,
          ),
      },
    }),
  );

/** Classic repositories tab for Pyxis listings. @public */
export const ProductPortfolioListingRepositories: ComponentType =
  productPortfolioPlugin.provide(
    createComponentExtension({
      name: 'ProductPortfolioListingRepositories',
      component: {
        lazy: () =>
          import('./components/product-listing/Repositories').then(
            m => m.ListingRepositories,
          ),
      },
    }),
  );

/** Classic entity overview for Pyxis repositories. @public */
export const ProductPortfolioRepositoryOverview: ComponentType =
  productPortfolioPlugin.provide(
    createComponentExtension({
      name: 'ProductPortfolioRepositoryOverview',
      component: {
        lazy: () =>
          import('./components/repository/Overview').then(
            m => m.RepositoryOverview,
          ),
      },
    }),
  );

/** Classic product listings tab for Pyxis repositories. @public */
export const ProductPortfolioRepositoryProductListings: ComponentType =
  productPortfolioPlugin.provide(
    createComponentExtension({
      name: 'ProductPortfolioRepositoryProductListings',
      component: {
        lazy: () =>
          import('./components/repository/ProductListings').then(
            m => m.RepositoryProductListings,
          ),
      },
    }),
  );

/** Classic entity overview for Pyxis teams. @public */
export const ProductPortfolioTeamOverview: ComponentType =
  productPortfolioPlugin.provide(
    createComponentExtension({
      name: 'ProductPortfolioTeamOverview',
      component: {
        lazy: () =>
          import('./components/team/Overview').then(m => m.TeamOverview),
      },
    }),
  );

/** Classic repositories tab for Pyxis teams. @public */
export const ProductPortfolioTeamRepositories: ComponentType =
  productPortfolioPlugin.provide(
    createComponentExtension({
      name: 'ProductPortfolioTeamRepositories',
      component: {
        lazy: () =>
          import('./components/team/Repositories').then(
            m => m.TeamRepositories,
          ),
      },
    }),
  );

/** Classic product listings tab for Pyxis teams. @public */
export const ProductPortfolioTeamProductListings: ComponentType =
  productPortfolioPlugin.provide(
    createComponentExtension({
      name: 'ProductPortfolioTeamProductListings',
      component: {
        lazy: () =>
          import('./components/team/ProductListings').then(
            m => m.TeamProductListings,
          ),
      },
    }),
  );

/** Classic Grades tab; the component selects the view from the current entity. @public */
export const ProductPortfolioGrades: ComponentType =
  productPortfolioPlugin.provide(
    createComponentExtension({
      name: 'ProductPortfolioGrades',
      component: {
        lazy: () => import('./components/grades/Grades').then(m => m.Grades),
      },
    }),
  );
