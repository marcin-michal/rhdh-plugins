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

/** Catalog-native Product Portfolio frontend. @packageDocumentation */
export {
  productPortfolioPlugin as default,
  productPortfolioPlugin,
} from './plugin';
export {
  ProductPortfolioPageExtension,
  ProductPortfolioListingOverview,
  ProductPortfolioListingRepositories,
  ProductPortfolioRepositoryOverview,
  ProductPortfolioRepositoryProductListings,
  ProductPortfolioTeamOverview,
  ProductPortfolioTeamRepositories,
  ProductPortfolioTeamProductListings,
  ProductPortfolioGrades,
} from './plugin';
/** @public */
export { ProductPortfolioPage } from './catalog/ProductPortfolioPage';
export {
  isPyxisListing,
  isPyxisRepository,
  isPyxisTeam,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
export { isPyxisPortfolioEntity } from './legacyConditions';
/** @public */
export { DashboardIcon as ProductPortfolioIcon } from '@backstage/core-components';
