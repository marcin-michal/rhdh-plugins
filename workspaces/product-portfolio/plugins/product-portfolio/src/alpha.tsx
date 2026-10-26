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

import { createFrontendPlugin } from '@backstage/frontend-plugin-api';
import { rootRouteRef } from './routes';
import { portfolioPage } from './extensions/portfolioPage';
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

/** Product Portfolio feature for the new frontend system. @alpha */
export default createFrontendPlugin({
  pluginId: 'product-portfolio',
  extensions: [
    portfolioPage,
    listingOverview,
    repositoryOverview,
    repositoryProductListings,
    listingRepositories,
    listingGrades,
    repositoryGrades,
    teamOverview,
    teamRepositories,
    teamProductListings,
    teamGrades,
  ],
  routes: { root: rootRouteRef },
  info: { packageJson: () => import('../package.json') },
});
