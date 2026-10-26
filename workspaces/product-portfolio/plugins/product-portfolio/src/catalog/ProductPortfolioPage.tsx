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
import {
  EntityListProvider,
  useEntityList,
  type DefaultEntityFilters,
} from '@backstage/plugin-catalog-react';
import { Box, Button, Flex } from '@backstage/ui';
import { PortfolioFilter, PortfolioScopeFilter } from './filters';
import {
  isPortfolioCategory,
  portfolioCategories,
  parseFilterState,
  serializeFilterState,
  type FilterState,
  type PortfolioCategory,
} from './filterState';
import { readEntity } from '../model/entities';
import { QualityNotice } from '../components/shared/QualityNotice';
import { PortfolioTable } from './PortfolioTable';
import { PortfolioToolbar, type PortfolioKindOption } from './PortfolioToolbar';

interface Filters extends DefaultEntityFilters {
  scope?: PortfolioScopeFilter;
  portfolio?: PortfolioFilter;
}

const managedCategories = portfolioCategories;
type ManagedCategory = PortfolioCategory;
type CategorySelection = 'all' | ManagedCategory;

const categoryLabels: Record<CategorySelection, string> = {
  all: 'All entries',
  listing: 'Product listings',
  repository: 'Repositories',
  team: 'Teams',
};

function categoryFromState(categories: PortfolioCategory[]): CategorySelection {
  const [category] = categories;
  if (categories.length === 1 && category && isPortfolioCategory(category)) {
    return category;
  }

  return 'all';
}

function PortfolioContent() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = useMemo(
    () => parseFilterState(location.search),
    [location.search],
  );
  const [query, setQuery] = useState(state.q);
  const [retry, setRetry] = useState(0);
  const selectedCategory = categoryFromState(state.categories);
  const { updateFilters, backendEntities, entities, loading, error } =
    useEntityList<Filters>();

  useEffect(() => {
    setQuery(state.q);
  }, [state.q]);

  const navigateToFilters = useCallback(
    (nextQuery: string, category: CategorySelection) => {
      const nextState: FilterState = {
        q: nextQuery.trim(),
        categories: category === 'all' ? [] : [category],
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

  const filterState = useMemo<FilterState>(
    () => ({
      q: state.q,
      categories:
        selectedCategory === 'all'
          ? [...managedCategories]
          : [selectedCategory],
    }),
    [selectedCategory, state.q],
  );

  useEffect(() => {
    updateFilters({
      scope: new PortfolioScopeFilter(),
      portfolio: new PortfolioFilter(filterState),
    });
  }, [filterState, retry, updateFilters]);

  const categoryCounts = useMemo(() => {
    const counts: Record<ManagedCategory, number> = {
      listing: 0,
      repository: 0,
      team: 0,
    };

    for (const entity of backendEntities) {
      const category = readEntity(entity).value?.category;
      if (category && category !== 'user') {
        counts[category] += 1;
      }
    }

    return counts;
  }, [backendEntities]);

  const totalCount = managedCategories.reduce(
    (sum, category) => sum + categoryCounts[category],
    0,
  );
  const selectedCount =
    selectedCategory === 'all' ? totalCount : categoryCounts[selectedCategory];
  const malformed = backendEntities.filter(
    entity => readEntity(entity).error,
  ).length;

  const filterKey = serializeFilterState(filterState);
  const teamLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const entity of backendEntities) {
      const model = readEntity(entity).value;
      if (model?.category !== 'team') {
        continue;
      }

      const record = model.projection.record;
      const name =
        record && 'name' in record && typeof record.name === 'string'
          ? record.name.trim()
          : '';
      labels.set(model.ref, name || model.projection.source.id);
    }
    return labels;
  }, [backendEntities]);

  const categoryOptions = useMemo<PortfolioKindOption[]>(
    () => [
      {
        id: 'all',
        label: categoryLabels.all,
        count: totalCount,
      },
      ...managedCategories.map(category => ({
        id: category,
        label: categoryLabels[category],
        count: categoryCounts[category],
      })),
    ],
    [categoryCounts, totalCount],
  );

  return (
    <Box p={{ initial: '4', md: '6' }}>
      <Flex direction="column" gap="4">
        <PortfolioToolbar
          options={categoryOptions}
          selectedKind={selectedCategory}
          query={query}
          currentCount={entities.length}
          totalCount={selectedCount}
          loading={loading}
          hasActiveFilters={Boolean(query) || selectedCategory !== 'all'}
          onKindChange={category => {
            if (category === 'all' || isPortfolioCategory(category)) {
              navigateToFilters(query, category);
            }
          }}
          onQueryChange={setQuery}
          onClearFilters={() => {
            setQuery('');
            navigateToFilters('', 'all');
          }}
        />

        {malformed > 0 && (
          <QualityNotice
            error
            message={`${malformed} catalog ${
              malformed === 1 ? 'entity does' : 'entities do'
            } not match the managed product portfolio schema.`}
          />
        )}

        {error ? (
          <Flex direction="column" gap="2">
            <QualityNotice
              error
              message="Product portfolio catalog data could not be loaded."
            />
            <Button onPress={() => setRetry(value => value + 1)}>Retry</Button>
          </Flex>
        ) : (
          <PortfolioTable
            key={filterKey}
            entities={entities}
            teamLabels={teamLabels}
            title={`${categoryLabels[selectedCategory]} (${entities.length})`}
            loading={loading}
          />
        )}
      </Flex>
    </Box>
  );
}

/** Dedicated source-scoped catalog page. @public */
export function ProductPortfolioPage() {
  return (
    <EntityListProvider pagination={false}>
      <PortfolioContent />
    </EntityListProvider>
  );
}
