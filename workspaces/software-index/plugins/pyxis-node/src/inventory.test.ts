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
import { PyxisInventoryReader } from './inventory';
import { baseline, fixtureClient, scanFixture, settings } from './testSupport';
import { PyxisReadError } from './client';

describe('vendor-admission source-normalization membership-roster associations inventory quality', () => {
  it('reads independent inventories, contributing rosters and all direct association states', async () => {
    const client = fixtureClient();
    const baselineScan = await scanFixture(client);

    expect(baselineScan.state).toBe('complete');
    expect(client.listTeams).not.toHaveBeenCalled();

    if (baselineScan.state !== 'complete') {
      throw new Error('scan failed');
    }

    expect(
      baselineScan.data.repositories.map(item => item.record._id),
    ).toContain(baseline.repositories[2]._id);

    const repositories = [
      { ...baseline.repositories[0], vendor_label: 'other' },
      { ...baseline.repositories[1], vendor_label: null },
    ];

    jest.mocked(client.listRepositories).mockResolvedValue({
      page: 0,
      pageSize: 100,
      total: 2,
      data: repositories,
    });

    const scan = await scanFixture(client);
    if (scan.state !== 'complete') {
      throw new Error('scan failed');
    }

    expect(scan.data.quality.admission).toBe('partial');
    expect(
      scan.data.listings[0].associations?.associations.map(a => a.status),
    ).toEqual(['excluded-vendor', 'admission-unresolved']);
  });

  it('resolves tracked and referenced records, preserving authoritative not-found evidence', async () => {
    const client = fixtureClient();
    jest
      .mocked(client.listListings)
      .mockResolvedValue({ page: 0, pageSize: 100, total: 0, data: [] });
    jest
      .mocked(client.listRepositories)
      .mockResolvedValue({ page: 0, pageSize: 100, total: 0, data: [] });

    const reader = new PyxisInventoryReader(
      'internal',
      client,
      settings.sources.internal,
      [
        {
          sourceInstance: 'internal',
          kind: 'listing',
          id: baseline.listings[0]._id,
        },
        {
          sourceInstance: 'internal',
          kind: 'listing',
          id: '100000000000000000000009',
        },
        {
          sourceInstance: 'internal',
          kind: 'repository',
          id: baseline.repositories[0]._id,
        },
        {
          sourceInstance: 'internal',
          kind: 'repository',
          id: '200000000000000000000009',
        },
        {
          sourceInstance: 'internal',
          kind: 'team',
          id: '300000000000000000000009',
        },
      ],
    );

    const result = await reader.scan({});
    if (result.state !== 'complete') {
      throw new Error('scan failed');
    }

    expect(result.data.notFound).toHaveLength(3);
    expect(result.data.repositories).toHaveLength(2);
    expect(result.data.quality.rosters).toBe('partial');
    expect(client.getRepository).toHaveBeenCalledTimes(3);
  });

  it('reports missing, malformed, opaque and unavailable contributing evidence', async () => {
    const client = fixtureClient();
    jest.mocked(client.listListings).mockResolvedValue({
      page: 0,
      pageSize: 100,
      total: 2,
      data: baseline.listings.map(record => ({
        ...record,
        repositories: null,
        team_id: null,
      })),
    });
    jest.mocked(client.listRepositories).mockResolvedValue({
      page: 0,
      pageSize: 100,
      total: 2,
      data: [
        {
          ...baseline.repositories[0],
          team_id: 'opaque',
          product_listings: null,
        },
        { ...baseline.repositories[1], team_id: '' },
      ],
    });

    const result = await scanFixture(client);
    if (result.state !== 'complete') {
      throw new Error('scan failed');
    }

    expect(result.data.quality).toMatchObject({
      associations: 'partial',
      projection: 'partial',
    });
    expect(result.data.repositories.map(r => r.ownership)).toEqual([
      'unresolved-opaque',
      'unresolved-owner',
    ]);
    expect(result.data.teams).toEqual([]);
  });

  it('records unprojectable targets, incomplete stored rosters and inverse discrepancies', async () => {
    const client = fixtureClient();
    jest.mocked(client.listRepositories).mockResolvedValue({
      page: 0,
      pageSize: 100,
      total: 1,
      data: [
        { ...baseline.repositories[0], team_id: '', product_listings: [] },
      ],
    });
    jest.mocked(client.getRepository).mockResolvedValue({
      state: 'not-found',
      authority: 'internal-source-404',
    });
    jest.mocked(client.getTeam).mockImplementation(async id => ({
      state: 'found',
      data: { _id: id, members: [null] },
    }));

    const result = await scanFixture(client);
    if (result.state !== 'complete') {
      throw new Error('scan failed');
    }

    expect(
      result.data.listings[0].associations?.associations.map(a => a.status),
    ).toEqual(['projection-unresolved', 'not-found']);
    expect(result.data.quality.rosters).toBe('partial');
    expect(result.data.listings[0].associations?.diagnostics).toHaveLength(1);
  });

  it('guards record limits during relationship reads and preserves typed failure codes', async () => {
    const client = fixtureClient();
    const reader = new PyxisInventoryReader('internal', client, {
      ...settings.sources.internal,
      maxRecords: 6,
    });
    expect(await reader.scan({})).toMatchObject({
      state: 'unavailable',
      diagnostics: [{ code: 'limit' }],
    });

    jest
      .mocked(client.listRepositories)
      .mockResolvedValue({ page: 0, pageSize: 100, total: 0, data: [] });
    expect(
      await new PyxisInventoryReader('internal', client, {
        ...settings.sources.internal,
        maxRecords: 3,
      }).scan({}),
    ).toMatchObject({ state: 'unavailable', diagnostics: [{ code: 'limit' }] });

    jest
      .mocked(client.listListings)
      .mockRejectedValueOnce(new PyxisReadError('authorization'));
    expect(await reader.scan({})).toMatchObject({
      state: 'unavailable',
      diagnostics: [
        {
          code: 'authorization',
          operation: 'inventory-scan',
          stage: 'listings',
          retryable: false,
          durationMs: expect.any(Number),
        },
      ],
    });

    jest
      .mocked(client.listListings)
      .mockRejectedValueOnce(new Error('private detail'));
    expect(await reader.scan({})).toMatchObject({
      state: 'unavailable',
      diagnostics: [{ code: 'inventory-failed' }],
    });
  });
});

it('pagination aggregate page and record boundaries are incomplete', async () => {
  for (const limits of [
    { ...settings.sources.internal, maxPages: 2 },
    { ...settings.sources.internal, maxRecords: 5 },
  ]) {
    expect(
      await new PyxisInventoryReader('internal', fixtureClient(), limits).scan(
        {},
      ),
    ).toMatchObject({ state: 'unavailable', diagnostics: [{ code: 'limit' }] });
  }
});

describe.each(['redhat-only', 'redhat-or-unlabeled'] as const)(
  'vendor-admission associations provider policy %s',
  policy => {
    it.each([
      ['redhat', 'admit'],
      ['other', 'exclude'],
      [null, 'unlabeled'],
      [undefined, 'unlabeled'],
      [42, 'unresolved'],
    ] as const)(
      'applies policy independently to listings and repositories for %s',
      async (label, expected) => {
        const client = fixtureClient();
        const change = <T extends { vendor_label: string }>(record: T) => {
          const { vendor_label: _vendor, ...rest } = record;
          return label === undefined ? rest : { ...rest, vendor_label: label };
        };
        jest.mocked(client.listListings).mockResolvedValue({
          page: 0,
          pageSize: 100,
          total: 2,
          data: baseline.listings.map(change),
        });
        jest.mocked(client.listRepositories).mockResolvedValue({
          page: 0,
          pageSize: 100,
          total: 3,
          data: baseline.repositories.map(change),
        });

        const scan = await new PyxisInventoryReader(
          'internal',
          client,
          settings.sources.internal,
          [],
          policy,
        ).scan({});
        if (scan.state !== 'complete') {
          throw new Error('incomplete scan');
        }

        const unlabeledDecision =
          policy === 'redhat-only' ? 'unresolved' : 'admit';
        const decision =
          expected === 'unlabeled' ? unlabeledDecision : expected;

        expect(
          [...scan.data.listings, ...scan.data.repositories].map(
            item => item.vendor.decision,
          ),
        ).toEqual(Array(5).fill(decision));
        expect(scan.data.quality.admission).toBe(
          decision === 'unresolved' ? 'partial' : 'complete',
        );

        const association = {
          admit: 'projected',
          exclude: 'excluded-vendor',
          unresolved: 'admission-unresolved',
        }[decision];
        expect(
          scan.data.listings.flatMap(item =>
            item.associations!.associations.map(link => link.status),
          ),
        ).toEqual(Array(3).fill(association));
      },
    );
  },
);
