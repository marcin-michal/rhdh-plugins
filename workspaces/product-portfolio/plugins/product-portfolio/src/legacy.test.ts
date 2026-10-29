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

import plugin, {
  ProductPortfolioGrades,
  ProductPortfolioIcon,
  ProductPortfolioListingOverview,
  ProductPortfolioListingRepositories,
  ProductPortfolioPageExtension,
  ProductPortfolioRepositoryOverview,
  ProductPortfolioRepositoryProductListings,
  ProductPortfolioTeamOverview,
  ProductPortfolioTeamProductListings,
  ProductPortfolioTeamRepositories,
  isPyxisListing,
  isPyxisRepository,
  isPyxisTeam,
  isPyxisPortfolioEntity,
} from './index';
import { fixtureEntity } from './testUtils/fixtures';

describe('classic frontend adapter', () => {
  it('exports the plugin, route, icon, filters, and every mounted view', () => {
    expect(plugin).toBeDefined();
    expect(ProductPortfolioPageExtension).toBeDefined();
    expect(ProductPortfolioIcon).toBeDefined();

    for (const view of [
      ProductPortfolioListingOverview,
      ProductPortfolioListingRepositories,
      ProductPortfolioRepositoryOverview,
      ProductPortfolioRepositoryProductListings,
      ProductPortfolioTeamOverview,
      ProductPortfolioTeamRepositories,
      ProductPortfolioTeamProductListings,
      ProductPortfolioGrades,
    ]) {
      expect(view).toBeDefined();
    }

    expect(isPyxisListing).toBeDefined();
    expect(isPyxisRepository).toBeDefined();
    expect(isPyxisTeam).toBeDefined();
    expect(isPyxisPortfolioEntity).toBeDefined();
  });

  it('shows the shared Grades view only for portfolio entities', () => {
    expect(isPyxisPortfolioEntity(fixtureEntity('listing'))).toBe(true);
    expect(isPyxisPortfolioEntity(fixtureEntity('repository'))).toBe(true);
    expect(isPyxisPortfolioEntity(fixtureEntity('team'))).toBe(true);
    expect(isPyxisPortfolioEntity(fixtureEntity('user'))).toBe(false);
  });
});
