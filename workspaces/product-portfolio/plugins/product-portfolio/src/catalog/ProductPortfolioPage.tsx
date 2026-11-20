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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Box, Flex } from '@backstage/ui';
import {
  isPortfolioCategory,
  portfolioCategories,
  parseFilterState,
  serializeFilterState,
  type FilterState,
  type PortfolioCategory,
} from './filterState';
import { PortfolioTable } from './PortfolioTable';
import { PortfolioToolbar, type PortfolioKindOption } from './PortfolioToolbar';

const categoryLabels: Record<PortfolioCategory, string> = {
  listing: 'Product listings',
  repository: 'Repositories',
  team: 'Teams',
};
const categoryOptions: PortfolioKindOption[] = portfolioCategories.map(
  category => ({
    id: category,
    label: categoryLabels[category],
  }),
);

/** Dedicated source-scoped catalog page. @public */
export function ProductPortfolioPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = useMemo(
    () => parseFilterState(location.search),
    [location.search],
  );
  const [query, setQuery] = useState(state.q);
  const selectedCategory = state.category;

  useEffect(() => {
    setQuery(state.q);
  }, [state.q]);

  const navigateToFilters = useCallback(
    (nextQuery: string, category: PortfolioCategory) => {
      const nextState: FilterState = {
        q: nextQuery.trim(),
        category,
      };
      navigate({ search: serializeFilterState(nextState) });
    },
    [navigate],
  );

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (normalizedQuery === state.q) {
      return undefined;
    }

    const timeout = window.setTimeout(
      () => navigateToFilters(normalizedQuery, selectedCategory),
      250,
    );

    return () => window.clearTimeout(timeout);
  }, [navigateToFilters, query, selectedCategory, state.q]);

  return (
    <Box p={{ initial: '4', md: '6' }}>
      <Flex direction="column" gap="4">
        <PortfolioToolbar
          options={categoryOptions}
          selectedKind={selectedCategory}
          query={query}
          hasActiveFilters={Boolean(query)}
          onKindChange={category => {
            if (isPortfolioCategory(category)) {
              navigateToFilters(query, category);
            }
          }}
          onQueryChange={setQuery}
          onClearFilters={() => {
            setQuery('');
            navigateToFilters('', selectedCategory);
          }}
        />

        <PortfolioTable
          kind={selectedCategory}
          search={state.q}
          title={categoryLabels[selectedCategory]}
        />
      </Flex>
    </Box>
  );
}
