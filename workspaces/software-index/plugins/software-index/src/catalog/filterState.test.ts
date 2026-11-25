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

import { parseFilterState, serializeFilterState } from './filterState';

describe('Software Index filter state', () => {
  it('normalizes invalid URL values and round trips category and search', () => {
    const base = parseFilterState('');
    expect(base).toEqual({ q: '', category: 'listing' });
    expect(parseFilterState('?categories=bad&q=%20%20')).toEqual(base);

    const state = parseFilterState('?categories=repository&q=registry');
    expect(parseFilterState(serializeFilterState(state))).toEqual(state);
    expect(parseFilterState('?categories=repository,team&q=registry')).toEqual({
      q: 'registry',
      category: 'listing',
    });
  });
});
