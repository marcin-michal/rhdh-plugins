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

import { stringifyEntityRef } from '@backstage/catalog-model';
import { CATALOG_FILTER_EXISTS } from '@backstage/plugin-catalog-react';
import { portfolioFixtures } from '../testUtils/fixtures';
import { PortfolioFilter, PortfolioScopeFilter } from './filters';
import { parseFilterState, serializeFilterState } from './filterState';

const fixtures = portfolioFixtures(13);
const base = parseFilterState('');
const run = (search: string) =>
  fixtures
    .filter(e => new PortfolioFilter(parseFilterState(search)).filterEntity(e))
    .map(stringifyEntityRef);

describe('portfolio filters', () => {
  it('fixes namespace and source annotation on the backend', () => {
    expect(new PortfolioScopeFilter().getCatalogFilters()).toEqual({
      'metadata.namespace': 'pyxis',
      'metadata.annotations.pyxis.redhat.com/source-instance':
        CATALOG_FILTER_EXISTS,
    });
  });

  it('normalizes invalid URL values and round trips category and name filters', () => {
    expect(parseFilterState('?categories=bad&q=%20%20')).toEqual(base);
    const state = parseFilterState('?categories=repository,listing&q=registry');
    expect(parseFilterState(serializeFilterState(state))).toEqual(state);
  });

  it.each([
    'Listing 1',
    'LISTING-1',
    '000000000000000000000001',
    'registry.redhat.io/portfolio',
  ])('searches title, name, id, and repository path: %s', q => {
    expect(run(`?q=${encodeURIComponent(q)}`).length).toBeGreaterThan(0);
  });

  it('filters by kind and name while keeping the list to portfolio entities', () => {
    const repositories = run('?categories=repository');
    expect(repositories.length).toBeGreaterThan(0);
    expect(
      repositories.every(ref => ref.startsWith('resource:pyxis/repository-')),
    ).toBe(true);
    expect(run('?categories=listing&q=listing-1')).toEqual([
      'resource:pyxis/listing-1',
    ]);
    expect(run('')).not.toContain('user:pyxis/user-1');
  });

  it('returns no entities for a name that does not match', () => {
    expect(run('?q=no-such-value')).toEqual([]);
  });
});
