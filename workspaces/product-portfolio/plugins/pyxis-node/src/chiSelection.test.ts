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

import type { ChiCandidate } from './ports';
import { ChiSelectionAccumulator } from './chiSelection';

const selectionAt = '2026-10-13T12:00:00.000Z';
const id = (suffix: string) => `0000000000000000000000${suffix}`;
const candidate = (
  imageId: string,
  architecture: string | null,
  stream: string,
  pushDate: string | null,
  overrides: Partial<ChiCandidate> = {},
): ChiCandidate => ({
  _id: imageId,
  architecture,
  deleted: false,
  repositories: [
    {
      registry: 'registry.redhat.io',
      repository: 'example/component',
      published: true,
      push_date: pushDate,
      tags: [
        {
          name: stream,
          added_date: '2026-10-01T00:00:00.000Z',
          removed_date: null,
        },
      ],
    },
  ],
  ...overrides,
});

const select = (
  candidates: ChiCandidate[],
  expectedArchitectures?: Record<string, string[]>,
) => {
  const accumulator = new ChiSelectionAccumulator({
    registry: 'registry.redhat.io',
    repository: 'example/component',
    streams: ['9.4', '9.4-extended'],
    selectionAt,
    expectedArchitectures,
    maxStreams: 8,
    maxArchitectureSlots: 16,
  });
  candidates.forEach(value => accumulator.add(value));
  return accumulator.finish();
};

describe('chi-latest-selection chi-stream-coverage', () => {
  it('selects the newest association per literal stream and architecture', () => {
    const result = select([
      candidate(id('01'), 'amd64', '9.4-extended', '2026-10-10T00:00:00Z'),
      candidate(id('02'), 'amd64', '9.4-extended', '2026-10-12T00:00:00Z'),
      candidate(id('03'), 'arm64', '9.4', '2026-10-11T00:00:00Z'),
    ]);

    expect(result.winners.map(value => value.imageId)).toEqual([
      id('02'),
      id('03'),
    ]);
    expect(result.streams[1].tag).toBe('9.4-extended');
    expect(result.streams[1].slots[0]).toMatchObject({
      state: 'selected',
      imageId: id('02'),
    });
  });

  it('does not rank by unrelated repository association timestamps', () => {
    const olderBase = candidate(
      id('04'),
      'amd64',
      '9.4',
      '2026-10-10T00:00:00Z',
    );
    const older: ChiCandidate = {
      ...olderBase,
      repositories: [
        ...olderBase.repositories,
        {
          registry: 'registry.redhat.io',
          repository: 'unrelated/component',
          published: true,
          push_date: '2026-10-13T00:00:00Z',
          tags: [
            {
              name: '9.4',
              added_date: '2026-10-01T00:00:00Z',
              removed_date: null,
            },
          ],
        },
      ],
    };
    const result = select([
      older,
      candidate(id('05'), 'amd64', '9.4', '2026-10-12T00:00:00Z'),
    ]);
    expect(result.winners.map(value => value.imageId)).toContain(id('05'));
  });

  it('keeps equal maxima uncertain without an ID tie break', () => {
    const result = select([
      candidate(id('06'), 'amd64', '9.4', '2026-10-12T00:00:00Z'),
      candidate(id('07'), 'amd64', '9.4', '2026-10-12T00:00:00Z'),
    ]);
    expect(result.streams[0].slots[0]).toMatchObject({
      state: 'uncertain',
      reason: 'tied-latest',
      imageId: null,
    });
  });

  it('selects independently of grade evidence and preserves shared membership', () => {
    const sharedBase = candidate(
      id('08'),
      'amd64',
      '9.4',
      '2026-10-12T00:00:00Z',
    );
    const shared: ChiCandidate = {
      ...sharedBase,
      repositories: [
        {
          ...sharedBase.repositories[0],
          tags: [
            ...sharedBase.repositories[0].tags,
            {
              name: '9.4-extended',
              added_date: '2026-10-01T00:00:00Z',
              removed_date: null,
            },
          ],
        },
      ],
    };
    const result = select([shared]);
    expect(result.winners).toHaveLength(1);
    expect(result.winners[0].selectedIn).toEqual(['9.4', '9.4-extended']);
  });

  it('exposes missing expected architectures without fabricating images', () => {
    const result = select(
      [candidate(id('09'), 'amd64', '9.4', '2026-10-12T00:00:00Z')],
      { '9.4': ['amd64', 's390x'] },
    );
    expect(result.streams[0].slots).toContainEqual({
      architecture: 's390x',
      state: 'missing',
      imageId: null,
      pushDate: null,
      reason: 'missing-expected-architecture',
    });
    expect(result.complete).toBe(false);
  });
});

describe('chi same-association uncertainty', () => {
  it.each([
    [null, 'invalid-architecture'],
    ['', 'invalid-architecture'],
  ])('marks architecture %p as %s', (architecture, issue) => {
    const result = select([
      candidate(id('10'), architecture, '9.4', '2026-10-12T00:00:00Z'),
    ]);
    expect(result.streams[0].issues).toContain(issue);
    expect(result.complete).toBe(false);
  });

  it('poisons ranking when a qualifying push date is missing', () => {
    const result = select([
      candidate(id('11'), 'amd64', '9.4', '2026-10-12T00:00:00Z'),
      candidate(id('12'), 'amd64', '9.4', null),
    ]);
    expect(result.streams[0].slots[0].reason).toBe('invalid-push-date');
    expect(result.winners).toHaveLength(0);
  });

  it('rejects stream and slot limits', () => {
    expect(
      () =>
        new ChiSelectionAccumulator({
          registry: 'registry.redhat.io',
          repository: 'example/component',
          streams: ['9.4', '9.4'],
          selectionAt,
          maxStreams: 8,
          maxArchitectureSlots: 8,
        }),
    ).toThrow('selection-limit');
    expect(
      () =>
        new ChiSelectionAccumulator({
          registry: 'registry.redhat.io',
          repository: 'example/component',
          streams: ['9.4', '9.5'],
          selectionAt,
          maxStreams: 1,
          maxArchitectureSlots: 8,
        }),
    ).toThrow('selection-limit');

    const accumulator = new ChiSelectionAccumulator({
      registry: 'registry.redhat.io',
      repository: 'example/component',
      streams: ['9.4'],
      selectionAt,
      maxStreams: 1,
      maxArchitectureSlots: 1,
    });
    accumulator.add(
      candidate(id('13'), 'amd64', '9.4', '2026-10-12T00:00:00Z'),
    );
    expect(() =>
      accumulator.add(
        candidate(id('14'), 'arm64', '9.4', '2026-10-12T00:00:00Z'),
      ),
    ).toThrow('selection-limit');
  });

  it('ignores deleted, unrelated, unpublished, removed and unconfigured associations', () => {
    const base = candidate(id('15'), 'amd64', '9.4', '2026-10-12T00:00:00Z');
    const result = select([
      { ...base, deleted: true },
      {
        ...base,
        _id: id('16'),
        repositories: [
          { ...base.repositories[0], registry: 'other.example.test' },
          { ...base.repositories[0], repository: 'other/component' },
          { ...base.repositories[0], published: false },
          {
            ...base.repositories[0],
            tags: [
              { ...base.repositories[0].tags[0], removed_date: selectionAt },
              { ...base.repositories[0].tags[0], name: 'unconfigured' },
              {
                ...base.repositories[0].tags[0],
                removed_date: undefined as unknown as null,
              },
            ],
          },
        ],
      },
    ]);
    expect(result.winners).toHaveLength(1);
    expect(result.winners[0].imageId).toBe(id('16'));
  });

  it.each([
    ['not-a-date', '2026-10-12T00:00:00Z'],
    ['2026-02-30T00:00:00Z', '2026-10-12T00:00:00Z'],
    ['2026-10-13T99:00:00Z', '2026-10-12T00:00:00Z'],
    ['2026-10-14T00:00:00Z', '2026-10-12T00:00:00Z'],
  ])('marks tag date %s uncertain', (added, pushed) => {
    const value = candidate(id('17'), 'amd64', '9.4', pushed);
    value.repositories[0].tags[0].added_date = added;
    expect(select([value]).streams[0].slots[0].reason).toBe('invalid-tag-date');
  });

  it.each(['2026-02-30T00:00:00Z', '2026-10-13T99:00:00Z'])(
    'marks push date %s uncertain',
    pushed => {
      expect(
        select([candidate(id('18'), 'amd64', '9.4', pushed)]).streams[0]
          .slots[0].reason,
      ).toBe('invalid-push-date');
    },
  );

  it('detects conflicting associations and preserves the first poison reason', () => {
    const value = candidate(id('19'), 'amd64', '9.4', '2026-10-12T00:00:00Z');
    value.repositories = [
      ...value.repositories,
      { ...value.repositories[0], push_date: '2026-10-11T00:00:00Z' },
    ];
    expect(select([value]).streams[0].slots[0].reason).toBe(
      'conflicting-association',
    );

    const poisoned = candidate(id('20'), 'amd64', '9.4', null);
    poisoned.repositories[0].tags[0].added_date = 'bad';
    poisoned.repositories = [
      ...poisoned.repositories,
      {
        ...poisoned.repositories[0],
        tags: [
          {
            ...poisoned.repositories[0].tags[0],
            added_date: '2026-10-01T00:00:00Z',
          },
        ],
      },
    ];
    expect(select([poisoned]).streams[0].slots[0].reason).toBe(
      'invalid-tag-date',
    );
  });

  it('allows a newer candidate to clear an older tie', () => {
    const result = select([
      candidate(id('21'), 'amd64', '9.4', '2026-10-10T00:00:00Z'),
      candidate(id('22'), 'amd64', '9.4', '2026-10-10T00:00:00Z'),
      candidate(id('23'), 'amd64', '9.4', '2026-10-12T00:00:00Z'),
      candidate(id('25'), 'amd64', '9.4', '2026-10-11T00:00:00Z'),
    ]);
    expect(result.winners.map(value => value.imageId)).toContain(id('23'));
  });

  it('poisons known slots when a qualifying candidate has invalid architecture', () => {
    const result = select([
      candidate(id('26'), 'amd64', '9.4', '2026-10-12T00:00:00Z'),
      candidate(id('27'), null, '9.4', '2026-10-13T00:00:00Z'),
    ]);
    expect(result.streams[0].slots[0]).toMatchObject({
      state: 'uncertain',
      reason: 'invalid-architecture',
    });
  });

  it('rejects invalid configured architectures and same ID across architectures', () => {
    expect(() => select([], { '9.4': ['bad architecture'] })).toThrow(
      'invalid-expected-architecture',
    );
    const accumulator = new ChiSelectionAccumulator({
      registry: 'registry.redhat.io',
      repository: 'example/component',
      streams: ['9.4', '9.4-extended'],
      selectionAt,
      maxStreams: 8,
      maxArchitectureSlots: 8,
    });
    accumulator.add(
      candidate(id('24'), 'amd64', '9.4', '2026-10-12T00:00:00Z'),
    );
    accumulator.add(
      candidate(id('24'), 'arm64', '9.4-extended', '2026-10-12T00:00:00Z'),
    );
    expect(() => accumulator.finish()).toThrow('selection-conflict');
  });
});
