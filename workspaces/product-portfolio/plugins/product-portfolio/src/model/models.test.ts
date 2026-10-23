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
  fixtureEntity,
  fixtureHealth,
  portfolioFixtures,
} from '../testUtils/fixtures';
import { readEntity } from './entities';
import { publicationState } from './publicationState';
import { aggregatePortfolioChi } from './portfolioChi';
import { readRepositoryChi, gradeLabel } from './repositoryChi';

const now = Date.parse('2026-10-14T10:30:00.000Z');
describe('portfolio models', () => {
  it.each(['listing', 'repository', 'team', 'user'] as const)(
    'validates %s entities',
    kind => {
      expect(readEntity(fixtureEntity(kind)).value?.category).toBe(kind);
    },
  );

  it('classifies publication precedence and not-applicable categories', () => {
    const e = fixtureEntity('listing');
    const m = readEntity(e).value!;
    for (const [record, expected] of [
      [{ deleted: true, published: true }, 'deleted'],
      [{ published: true }, 'published'],
      [{ published: false }, 'unpublished'],
      [{ published: null }, 'unknown'],
      [{}, 'unknown'],
    ] as const)
      expect(
        publicationState({
          ...m,
          projection: { ...m.projection, record: { _id: 'x', ...record } },
        }),
      ).toBe(expected);
    expect(publicationState(readEntity(fixtureEntity('user')).value!)).toBe(
      'not-applicable',
    );
    expect(publicationState(readEntity(fixtureEntity('team')).value!)).toBe(
      'not-applicable',
    );
  });

  it('rejects malformed data and CHI source mismatch', () => {
    const e = fixtureEntity('repository');
    expect(readRepositoryChi(e, now).error).toContain('schema 2');
    const health = fixtureHealth(e);
    health.snapshot!.source.id = 'different';
    e.spec!.pyxisChi = JSON.parse(JSON.stringify(health));
    expect(readRepositoryChi(e, now).error).toContain('schema 2');
    expect(
      readEntity({ ...e, spec: { pyxis: { version: '99' } } }).error,
    ).toContain('version 1');
  });

  it('deduplicates tags and repository images, omits empty buckets and distinguishes scheduled A', () => {
    const first = fixtureEntity('repository', 1);
    const h = fixtureHealth(first);
    h.snapshot!.images = [
      h.snapshot!.images[0],
      { ...h.snapshot!.images[0], selectedIn: ['extra'] },
    ];
    first.spec!.pyxisChi = JSON.parse(JSON.stringify(h));
    const second = fixtureEntity('repository', 2);
    const h2 = fixtureHealth(second);
    h2.snapshot!.images[0].futureDrops = [
      { from: 'A', to: 'B', at: '2099-01-01T00:00:00Z' },
    ];
    second.spec!.pyxisChi = JSON.parse(JSON.stringify(h2));
    const result = aggregatePortfolioChi([first, first, second], now);
    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0].images).toHaveLength(2);
    expect(result.buckets[0].images[0].image.selectedIn).toEqual([
      'latest',
      '9.4',
      'extra',
    ]);
    expect(gradeLabel(result.buckets[0].images[0].image)).toContain('stable');
    expect(gradeLabel(result.buckets[0].images[1].image)).toContain(
      'scheduled',
    );
  });

  it.each(['A', 'B', 'C', 'D', 'E', 'F', null] as const)(
    'buckets grade %s without recalculation',
    grade => {
      const e = fixtureEntity('repository');
      e.spec!.pyxisChi = JSON.parse(
        JSON.stringify(fixtureHealth(e, 'ready', grade)),
      );
      expect(aggregatePortfolioChi([e], now).buckets.map(b => b.grade)).toEqual(
        [grade ?? 'Unknown'],
      );
    },
  );

  it('preserves health availability and architecture coverage without fake Unknown grades', () => {
    const repos = portfolioFixtures(13).filter(e =>
      e.metadata.name.startsWith('repository'),
    );
    const result = aggregatePortfolioChi(repos, now);
    expect(result.aggregate.repositories).toMatchObject({
      ready: 1,
      partial: 1,
      empty: 1,
      hidden: 1,
      unavailable: 1,
      disabled: 1,
    });
    expect(result.aggregate.streams.missingArchitectureSlots).toBe(2);
    expect(result.buckets.map(b => b.grade)).toEqual(['A']);
    expect(result.aggregate.complete).toBe(false);
  });
});
