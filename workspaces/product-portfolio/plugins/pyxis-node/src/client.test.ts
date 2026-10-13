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

import { MockAgent } from 'undici';
import { ConfigReader } from '@backstage/config';
// Shared synthetic fixture is never a production package dependency.
// eslint-disable-next-line @backstage/no-relative-monorepo-imports
import baseline from '../../../test/fixtures/pyxis/baseline.json';
import { PyxisClient, checkRead, readAllPages } from './client';
import { readPyxisConfig } from './config';
import { classifyVendor } from './normalization';

const endpoint = 'https://pyxis.example.test';
const config = readPyxisConfig(
  new ConfigReader({
    pyxis: {
      sources: {
        internal: {
          endpoint: `${endpoint}/graphql`,
          certificateFile: '/unused',
          keyFile: '/unused',
          maxAttempts: 1,
        },
      },
    },
  }),
).sources.internal;
const result = (operation: string, data: unknown, extra: object = {}) => ({
  data: { [operation]: { error: null, data, ...extra } },
});

describe('http-query-contract HTTP/query contract', () => {
  let agent: MockAgent;
  let client: PyxisClient;

  beforeEach(() => {
    agent = new MockAgent();
    agent.disableNetConnect();
    client = new PyxisClient(config, agent, 'internal', () => 0);
  });

  afterEach(async () => {
    agent.assertNoPendingInterceptors();
    await client.close();
  });

  it('uses variables, exact projections, independent finds and no write operations', async () => {
    agent
      .get(endpoint)
      .intercept({
        path: '/graphql',
        method: 'POST',
        body: body => {
          const request = JSON.parse(String(body));

          expect(request.variables).toEqual({
            page: 0,
            pageSize: 100,
            filter: {
              or: [
                { vendor_label: { eq: 'redhat' } },
                { vendor_label: { eq: null } },
              ],
            },
          });
          expect(request.query).toBe(
            'query Inventory($page: Int!, $pageSize: Int!, $filter: ProductListingFilter) { find_product_listings(page: $page, page_size: $pageSize, filter: $filter, sort_by: [{field: "_id", order: ASC}]) { error { status detail } page page_size total data { _id name vendor_label team_id repositories published deleted last_update_date } } }',
          );

          return true;
        },
      })
      .reply(
        200,
        result('find_product_listings', baseline.listings, {
          page: 0,
          page_size: 100,
          total: 2,
        }),
      );

    expect(
      (await client.listListings({ page: 0, pageSize: 100 })).data,
    ).toHaveLength(2);

    agent
      .get(endpoint)
      .intercept({ path: '/graphql', method: 'POST' })
      .reply(
        200,
        result('find_repositories', baseline.repositories, {
          page: 0,
          page_size: 100,
          total: 3,
        }),
      );

    expect(
      (await client.listRepositories({ page: 0, pageSize: 100 })).data[1]
        .published,
    ).toBe(false);

    agent
      .get(endpoint)
      .intercept({ path: '/graphql', method: 'POST' })
      .reply(
        200,
        result('find_teams', baseline.teams, {
          page: 0,
          page_size: 100,
          total: 2,
        }),
      );

    expect(
      (await client.listTeams({ page: 0, pageSize: 100 })).data,
    ).toHaveLength(2);
  });

  it.each(['listing', 'repository'] as const)(
    'vendor-admission keeps null and missing %s candidate evidence available to both policies',
    async kind => {
      const { vendor_label: _vendor, ...base } =
        kind === 'listing' ? baseline.listings[0] : baseline.repositories[0];
      const data = [
        { ...base, _id: '400000000000000000000001', vendor_label: 'redhat' },
        { ...base, _id: '400000000000000000000002', vendor_label: null },
        { ...base, _id: '400000000000000000000003' },
      ];

      agent
        .get(endpoint)
        .intercept({
          path: '/graphql',
          method: 'POST',
          body: body => {
            expect(JSON.parse(String(body)).variables.filter).toEqual({
              or: [
                { vendor_label: { eq: 'redhat' } },
                { vendor_label: { eq: null } },
              ],
            });
            return true;
          },
        })
        .reply(
          200,
          result(
            kind === 'listing' ? 'find_product_listings' : 'find_repositories',
            data,
            { page: 0, page_size: 100, total: 3 },
          ),
        );

      const page = await (kind === 'listing'
        ? client.listListings({ page: 0, pageSize: 100 })
        : client.listRepositories({ page: 0, pageSize: 100 }));

      expect(page.data.map(record => classifyVendor(record).decision)).toEqual([
        'admit',
        'unresolved',
        'unresolved',
      ]);
      expect(
        page.data.map(
          record => classifyVendor(record, 'redhat-or-unlabeled').decision,
        ),
      ).toEqual(['admit', 'admit', 'admit']);
      expect(page.data[1]).toHaveProperty('vendor_label', null);
      expect(page.data[2]).not.toHaveProperty('vendor_label');
    },
  );
  it('validates ID lookups and only recognizes structured inner 404', async () => {
    for (const [kind, record, call] of [
      [
        'get_product_listing',
        baseline.listings[0],
        () => client.getListing(baseline.listings[0]._id, {}),
      ],
      [
        'get_repository',
        baseline.repositories[0],
        () => client.getRepository(baseline.repositories[0]._id, {}),
      ],
      [
        'get_team',
        baseline.teams[0],
        () => client.getTeam(baseline.teams[0]._id, {}),
      ],
    ] as const) {
      agent
        .get(endpoint)
        .intercept({ path: '/graphql', method: 'POST' })
        .reply(200, result(kind, record));
      expect((await call()).state).toBe('found');
    }

    agent
      .get(endpoint)
      .intercept({ path: '/graphql', method: 'POST' })
      .reply(200, {
        data: {
          get_repository: {
            data: null,
            error: { status: 404, detail: 'not found' },
          },
        },
      });

    expect(
      await client.getRepository(baseline.repositories[0]._id, {}),
    ).toEqual({ state: 'not-found', authority: 'internal-source-404' });
    await expect(client.getTeam('opaque', {})).rejects.toThrow('validation');
  });

  it.each([-1, 0.5])('rejects invalid page %s before transport', async page => {
    await expect(client.listListings({ page, pageSize: 100 })).rejects.toThrow(
      'validation',
    );
  });

  it('rejects overlarge responses', async () => {
    client = new PyxisClient(
      { ...config, maxResponseBytes: 10 },
      agent,
      'internal',
    );
    agent
      .get(endpoint)
      .intercept({ path: '/graphql', method: 'POST' })
      .reply(200, { too: 'large response body' });
    await expect(
      client.listListings({ page: 0, pageSize: 100 }),
    ).rejects.toThrow('limit');
  });

  describe('failure-classification failure classification', () => {
    it.each([
      [401, {}, 'authorization'],
      [403, {}, 'authorization'],
      [404, {}, 'http'],
      [302, {}, 'http'],
      [429, {}, 'http'],
      [503, {}, 'http'],
      [200, 'not-json', 'validation'],
      [200, {}, 'validation'],
      [200, { errors: [{ message: 'private upstream detail' }] }, 'graphql'],
      [
        200,
        { data: { get_repository: { data: null, error: { status: 403 } } } },
        'source',
      ],
      [
        200,
        { data: { get_repository: { data: null, error: null } } },
        'validation',
      ],
      [200, { data: { get_repository: { error: null } } }, 'validation'],
    ])(
      'classifies case %# without leaking source bodies',
      async (status, body, code) => {
        agent
          .get(endpoint)
          .intercept({ path: '/graphql', method: 'POST' })
          .reply(status as number, body);
        await expect(
          client.getRepository(baseline.repositories[0]._id, {}),
        ).rejects.toMatchObject({ code });
      },
    );

    it.each([
      ['VPN', 'connect EHOSTUNREACH vpn.internal.test:443'],
      ['DNS', 'getaddrinfo ENOTFOUND pyxis.example.test'],
      ['transport', 'socket hang up response-body-secret'],
    ])(
      'classifies %s failures without retaining network details',
      async (_kind, detail) => {
        agent
          .get(endpoint)
          .intercept({ path: '/graphql', method: 'POST' })
          .replyWithError(new Error(detail));

        const error = await client
          .getRepository(baseline.repositories[0]._id, {})
          .catch(reason => reason);
        expect(error).toMatchObject({ code: 'transport', retryable: true });
        expect(String(error)).not.toContain(detail);
      },
    );
  });
});

describe('pagination pagination', () => {
  const limits = { pageSize: 1, maxPages: 10, maxRecords: 100 };

  it('traverses every page and distinguishes complete empty', async () => {
    const read = jest.fn(async input => ({
      data: [baseline.listings[input.page]],
      page: input.page,
      pageSize: 1,
      total: 2,
    }));
    expect((await readAllPages(read, limits, {})).records).toHaveLength(2);
    expect(read).toHaveBeenCalledTimes(2);
    expect(
      (
        await readAllPages(
          async () => ({ data: [], page: 0, pageSize: 1, total: 0 }),
          limits,
          {},
        )
      ).records,
    ).toEqual([]);
  });

  it.each([
    'total',
    'page',
    'pageSize',
    'empty',
    'duplicate',
    'conflict',
    'page-limit',
    'record-limit',
  ])('rejects incoherent %s traversal', async scenario => {
    const read = async (input: { page: number }) => ({
      data:
        scenario === 'empty'
          ? []
          : [
              {
                ...baseline.listings[
                  scenario === 'duplicate' || scenario === 'conflict'
                    ? 0
                    : input.page
                ],
                ...(scenario === 'conflict'
                  ? { name: String(input.page) }
                  : {}),
              },
            ],
      page: scenario === 'page' ? 99 : input.page,
      pageSize: scenario === 'pageSize' ? 2 : 1,
      total: scenario === 'total' && input.page > 0 ? 3 : 2,
    });

    await expect(
      readAllPages(
        read,
        {
          ...limits,
          ...(scenario === 'page-limit' ? { maxPages: 1 } : {}),
          ...(scenario === 'record-limit' ? { maxRecords: 1 } : {}),
        },
        {},
      ),
    ).rejects.toThrow('pyxis-');
  });
});

describe('retry-cancellation retry and cancellation', () => {
  it('bounds concurrency, cancels queued callers and releases the next waiter', async () => {
    const agent = new MockAgent();
    agent.disableNetConnect();
    const client = new PyxisClient(
      { ...config, concurrency: 1 },
      agent,
      'internal',
    );
    agent
      .get(endpoint)
      .intercept({ path: '/graphql', method: 'POST' })
      .reply(200, result('get_repository', baseline.repositories[0]))
      .delay(25);
    agent
      .get(endpoint)
      .intercept({ path: '/graphql', method: 'POST' })
      .reply(200, result('get_repository', baseline.repositories[0]));

    const first = client.getRepository(baseline.repositories[0]._id, {});
    const controller = new AbortController();
    const cancelled = client.getRepository(baseline.repositories[0]._id, {
      signal: controller.signal,
    });
    const third = client.getRepository(baseline.repositories[0]._id, {});

    controller.abort();
    await expect(cancelled).rejects.toThrow('cancelled');
    expect((await first).state).toBe('found');
    expect((await third).state).toBe('found');
    agent.assertNoPendingInterceptors();
    await client.close();
  });

  it('cancels during backoff and retries recognized transient GraphQL errors', async () => {
    const agent = new MockAgent();
    agent.disableNetConnect();
    const client = new PyxisClient(
      { ...config, maxAttempts: 2 },
      agent,
      'internal',
      () => 0,
    );

    agent
      .get(endpoint)
      .intercept({ path: '/graphql', method: 'POST' })
      .reply(200, { errors: [{ extensions: { error: { status: 503 } } }] });
    agent
      .get(endpoint)
      .intercept({ path: '/graphql', method: 'POST' })
      .reply(200, result('get_repository', baseline.repositories[0]));
    expect(
      (await client.getRepository(baseline.repositories[0]._id, {})).state,
    ).toBe('found');

    const controller = new AbortController();
    agent
      .get(endpoint)
      .intercept({ path: '/graphql', method: 'POST' })
      .reply(() => {
        setTimeout(() => controller.abort(), 5);
        return { statusCode: 503, data: '{}' };
      });
    await expect(
      client.getRepository(baseline.repositories[0]._id, {
        signal: controller.signal,
      }),
    ).rejects.toThrow('cancelled');
    agent.assertNoPendingInterceptors();
    await client.close();
  });

  it('honors Retry-After HTTP dates and exhausts a bounded attempt budget', async () => {
    const agent = new MockAgent();
    agent.disableNetConnect();
    const client = new PyxisClient(
      { ...config, maxAttempts: 2 },
      agent,
      'internal',
      () => 0,
    );

    agent
      .get(endpoint)
      .intercept({ path: '/graphql', method: 'POST' })
      .reply(
        503,
        {},
        {
          headers: {
            'retry-after': new Date(Date.now() + 100000).toUTCString(),
          },
        },
      );

    await expect(
      client.getRepository(baseline.repositories[0]._id, {
        deadline: Date.now() + 1000,
      }),
    ).rejects.toThrow('deadline');
    agent
      .get(endpoint)
      .intercept({ path: '/graphql', method: 'POST' })
      .reply(503, {}, { headers: { 'retry-after': 'invalid' } });
    agent
      .get(endpoint)
      .intercept({ path: '/graphql', method: 'POST' })
      .reply(503, {});
    await expect(
      client.getRepository(baseline.repositories[0]._id, {}),
    ).rejects.toMatchObject({ code: 'http', retryable: true });
    agent.assertNoPendingInterceptors();
    await client.close();
  });

  it('honors attempts, Retry-After and cancellation budgets', async () => {
    const agent = new MockAgent();
    agent.disableNetConnect();
    const client = new PyxisClient(
      { ...config, maxAttempts: 2 },
      agent,
      'internal',
      () => 0,
    );
    agent
      .get(endpoint)
      .intercept({ path: '/graphql', method: 'POST' })
      .reply(429, {}, { headers: { 'retry-after': '0' } });
    agent
      .get(endpoint)
      .intercept({ path: '/graphql', method: 'POST' })
      .reply(200, result('get_repository', baseline.repositories[0]));
    expect(
      (await client.getRepository(baseline.repositories[0]._id, {})).state,
    ).toBe('found');
    agent
      .get(endpoint)
      .intercept({ path: '/graphql', method: 'POST' })
      .reply(429, {}, { headers: { 'retry-after': '100' } });
    await expect(
      client.getRepository(baseline.repositories[0]._id, {
        deadline: Date.now() + 1000,
      }),
    ).rejects.toThrow('deadline');
    await expect(
      client.getRepository(baseline.repositories[0]._id, {
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrow('cancelled');
    expect(() => checkRead({ deadline: 0 })).toThrow('deadline');
    agent.assertNoPendingInterceptors();
    await client.close();
  });
});
