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
import { readEntity, sourceKey } from '../model/entities';
import { QualityNotice } from '../components/shared/QualityNotice';
import { PortfolioTable } from './PortfolioTable';
import type { PortfolioTeam } from './columns';
import { PortfolioToolbar, type PortfolioKindOption } from './PortfolioToolbar';

interface Filters extends DefaultEntityFilters {
  scope?: PortfolioScopeFilter;
  portfolio?: PortfolioFilter;
}

const categoryLabels: Record<PortfolioCategory, string> = {
  listing: 'Product listings',
  repository: 'Repositories',
  team: 'Teams',
};

function PortfolioContent() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = useMemo(
    () => parseFilterState(location.search),
    [location.search],
  );
  const [query, setQuery] = useState(state.q);
  const [retry, setRetry] = useState(0);
  const selectedCategory = state.category;
  const { updateFilters, backendEntities, entities, loading, error } =
    useEntityList<Filters>();

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

  const filterState = useMemo<FilterState>(
    () => ({
      q: state.q,
      category: selectedCategory,
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
    const counts: Record<PortfolioCategory, number> = {
      listing: 0,
      repository: 0,
      team: 0,
    };

    for (const entity of backendEntities) {
      const category = readEntity(entity).value?.category;
      if (category && isPortfolioCategory(category)) {
        counts[category] += 1;
      }
    }

    return counts;
  }, [backendEntities]);

  const selectedCount = categoryCounts[selectedCategory];
  const malformed = backendEntities.filter(
    entity => readEntity(entity).error,
  ).length;

  const filterKey = serializeFilterState(filterState);
  const teamDirectory = useMemo(() => {
    const teams = new Map<string, PortfolioTeam>();
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
      const label = name || entity.metadata.title?.trim() || '';
      if (!label) {
        continue;
      }

      const team: PortfolioTeam = { entity, ref: model.ref, label };
      teams.set(model.ref, team);
      teams.set(sourceKey(model.projection.source), team);
    }
    return teams;
  }, [backendEntities]);

  const categoryOptions = useMemo<PortfolioKindOption[]>(
    () =>
      portfolioCategories.map(category => ({
        id: category,
        label: categoryLabels[category],
        count: categoryCounts[category],
      })),
    [categoryCounts],
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
            kind={selectedCategory}
            entities={entities}
            teamDirectory={teamDirectory}
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
