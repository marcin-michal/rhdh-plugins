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

export const portfolioCategories = ['listing', 'repository', 'team'] as const;
export type PortfolioCategory = (typeof portfolioCategories)[number];

export interface FilterState {
  q: string;
  categories: PortfolioCategory[];
}

export function isPortfolioCategory(value: string): value is PortfolioCategory {
  return portfolioCategories.includes(value as PortfolioCategory);
}

export function parseFilterState(search: string): FilterState {
  const params = new URLSearchParams(search);
  const selected = (params.get('categories') ?? '').split(',');

  return {
    q: params.get('q')?.trim() ?? '',
    categories: portfolioCategories.filter(category =>
      selected.includes(category),
    ),
  };
}

export function serializeFilterState(state: FilterState): string {
  const params = new URLSearchParams();
  const query = state.q.trim();
  const selected = portfolioCategories.filter(category =>
    state.categories.includes(category),
  );

  if (query) {
    params.set('q', query);
  }
  if (selected.length) {
    params.set('categories', selected.join(','));
  }

  return params.toString();
}
