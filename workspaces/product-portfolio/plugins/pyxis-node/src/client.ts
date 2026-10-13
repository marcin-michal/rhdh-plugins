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

import { readFile } from 'node:fs/promises';
import { createSecureContext } from 'node:tls';
import { setTimeout as delay } from 'node:timers/promises';
import { Agent, request, type Dispatcher } from 'undici';
import { metrics } from '@opentelemetry/api';
import { z } from 'zod';
import type {
  SourceListing,
  SourceRepository,
  SourceTeam,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import type { PyxisSourceConfig } from './config';
import type {
  Lookup,
  PageRequest,
  PyxisReadClient,
  ReadOptions,
  SourcePage,
  TeamPageRequest,
} from './ports';
import { canonicalId, isObjectId, sourceSchemas } from './normalization';

/** Safe transport failure; source bodies and secrets are never retained. @public */
export class PyxisReadError extends Error {
  constructor(
    readonly code:
      | 'cancelled'
      | 'deadline'
      | 'transport'
      | 'http'
      | 'authorization'
      | 'graphql'
      | 'source'
      | 'validation'
      | 'limit'
      | 'pagination',
    readonly retryable = false,
    readonly retryAfterMs?: number,
  ) {
    super(`pyxis-${code}`);
  }
}

/** Read cancellation also checks the caller's absolute operation budget. @public */
export function checkRead(options: ReadOptions): void {
  if (options.signal?.aborted) {
    throw new PyxisReadError('cancelled');
  }

  if (options.deadline !== undefined && Date.now() >= options.deadline) {
    throw new PyxisReadError('deadline');
  }
}

const descriptors = {
  listing: {
    single: 'get_product_listing',
    many: 'find_product_listings',
    filter: 'ProductListingFilter',
    projection:
      '_id name vendor_label team_id repositories published deleted last_update_date',
  },
  repository: {
    single: 'get_repository',
    many: 'find_repositories',
    filter: 'ContainerRepositoryFilter',
    projection:
      '_id vendor_label registry repository display_data { name } team_id product_listings published last_update_date',
  },
  team: {
    single: 'get_team',
    many: 'find_teams',
    filter: 'ContainerTeamFilter',
    projection: '_id name members { user_id role added_date } last_update_date',
  },
} as const;
type Kind = keyof typeof descriptors;

const envelopeSchema = z.object({
  data: z.record(z.unknown()).nullish(),
  errors: z
    .array(
      z.object({
        extensions: z
          .object({ error: z.object({ status: z.number() }).optional() })
          .optional(),
      }),
    )
    .optional(),
});

const resultSchema = z
  .object({
    error: z
      .object({ status: z.number().int(), detail: z.string().optional() })
      .nullable(),
    data: z.unknown(),
  })
  .passthrough();

const pageSchema = z.object({
  page: z.number().int().nonnegative(),
  page_size: z.number().int().min(1).max(500),
  total: z.number().int().nonnegative(),
  data: z.array(z.unknown()),
});

const transient = (status: number) =>
  status === 429 || [500, 502, 503, 504].includes(status);

/** Read-only client with bounded transport, retries, and mTLS verification. @public */
export class PyxisClient implements PyxisReadClient {
  private readonly shutdown = new AbortController();
  private closing?: Promise<void>;
  private active = 0;
  private readonly queue: (() => void)[] = [];
  private readonly meter = metrics.getMeter('pyxis-consumer', '1');
  private readonly requests = this.meter.createCounter('pyxis.requests');
  private readonly retries = this.meter.createCounter('pyxis.retries');
  private readonly latency = this.meter.createHistogram(
    'pyxis.request.duration',
    { unit: 's' },
  );

  constructor(
    private readonly config: PyxisSourceConfig,
    private readonly dispatcher: Dispatcher,
    private readonly sourceInstance: string,
    private readonly jitter: () => number = Math.random,
  ) {}

  static async create(
    config: PyxisSourceConfig,
    sourceInstance: string,
  ): Promise<PyxisClient> {
    try {
      const [cert, key, ca] = await Promise.all([
        readFile(config.certificateFile),
        readFile(config.keyFile),
        config.caFile ? readFile(config.caFile) : undefined,
      ]);
      createSecureContext({ cert, key, ca });

      return new PyxisClient(
        config,
        new Agent({
          connect: { cert, key, ca, rejectUnauthorized: true },
          connections: config.concurrency,
        }),
        sourceInstance,
      );
    } catch {
      throw new Error('pyxis-invalid-tls-material');
    }
  }

  async close(): Promise<void> {
    this.shutdown.abort();
    this.closing ??= this.dispatcher.close();
    await this.closing;
  }

  private async acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();

    if (this.active >= this.config.concurrency) {
      await new Promise<void>((resolve, reject) => {
        // Queue callbacks refer to one another; neither runs until both exist.
        const ready = () => {
          // eslint-disable-next-line @typescript-eslint/no-use-before-define
          signal.removeEventListener('abort', abort);
          resolve();
        };

        const abort = () => {
          const index = this.queue.indexOf(ready);
          if (index >= 0) this.queue.splice(index, 1);
          reject(new PyxisReadError('cancelled'));
        };

        this.queue.push(ready);
        signal.addEventListener('abort', abort, { once: true });
      });
    } else {
      this.active += 1;
    }

    return () => {
      const next = this.queue.shift();
      if (next) {
        next();
      } else {
        this.active -= 1;
      }
    };
  }

  private async execute(
    kind: Kind,
    many: boolean,
    variables: Record<string, unknown>,
    options: ReadOptions,
  ): Promise<Record<string, unknown>> {
    const operation = descriptors[kind][many ? 'many' : 'single'];
    const d = descriptors[kind];
    const query = many
      ? `query Inventory($page: Int!, $pageSize: Int!, $filter: ${d.filter}) { ${operation}(page: $page, page_size: $pageSize, filter: $filter, sort_by: [{field: "_id", order: ASC}]) { error { status detail } page page_size total data { ${d.projection} } } }`
      : `query Lookup($id: ObjectIDFilterScalar!) { ${operation}(id: $id) { error { status detail } data { ${d.projection} } } }`;
    const deadline =
      options.deadline ??
      Date.now() +
        this.config.attemptTimeoutMs * this.config.maxAttempts +
        15000;
    const signals = [
      this.shutdown.signal,
      AbortSignal.timeout(Math.max(1, deadline - Date.now())),
    ];

    if (options.signal) {
      signals.push(options.signal);
    }

    const signal = AbortSignal.any(signals);
    checkRead({ ...options, deadline });
    const release = await this.acquire(signal);

    try {
      for (let attempt = 0; ; attempt += 1) {
        checkRead({ signal, deadline });
        const started = Date.now();
        let outcome = 'success';

        try {
          const attemptSignal = AbortSignal.any([
            signal,
            AbortSignal.timeout(this.config.attemptTimeoutMs),
          ]);

          const response = await request(this.config.endpoint, {
            dispatcher: this.dispatcher,
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              accept: 'application/json',
            },
            body: JSON.stringify({ query, variables }),
            signal: attemptSignal,
            headersTimeout: this.config.attemptTimeoutMs,
            bodyTimeout: this.config.attemptTimeoutMs,
          });

          if (response.statusCode !== 200) {
            response.body.destroy();
            const retry = response.headers['retry-after'];
            const value = typeof retry === 'string' ? retry : '';
            let retryAfter: number | undefined;

            if (value) {
              retryAfter = /^\d+$/.test(value)
                ? Number(value) * 1000
                : Math.max(0, Date.parse(value) - Date.now());
            }

            throw new PyxisReadError(
              [401, 403].includes(response.statusCode)
                ? 'authorization'
                : 'http',
              transient(response.statusCode),
              Number.isFinite(retryAfter) ? retryAfter : undefined,
            );
          }

          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of response.body) {
            size += chunk.length;
            if (size > this.config.maxResponseBytes) {
              response.body.destroy();
              throw new PyxisReadError('limit');
            }
            chunks.push(Buffer.from(chunk));
          }

          let raw: unknown;
          try {
            raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            throw new PyxisReadError('validation');
          }

          const parsed = envelopeSchema.safeParse(raw);
          if (!parsed.success) {
            throw new PyxisReadError('validation');
          }
          if (parsed.data.errors?.length) {
            throw new PyxisReadError(
              'graphql',
              parsed.data.errors.every(error =>
                transient(error.extensions?.error?.status ?? 0),
              ),
            );
          }

          const result = resultSchema.safeParse(parsed.data.data?.[operation]);
          if (!result.success || !Object.hasOwn(result.data, 'data')) {
            throw new PyxisReadError('validation');
          }
          if (result.data.error) {
            if (
              !many &&
              result.data.error.status === 404 &&
              result.data.data === null
            ) {
              return { notFound: true };
            }

            throw new PyxisReadError(
              'source',
              transient(result.data.error.status),
            );
          }
          return result.data;
        } catch (error) {
          const failure =
            error instanceof PyxisReadError
              ? error
              : new PyxisReadError('transport', true);
          outcome = failure.code;
          checkRead({ signal, deadline });

          if (!failure.retryable || attempt + 1 >= this.config.maxAttempts) {
            throw failure;
          }

          const backoff =
            failure.retryAfterMs ??
            Math.min(5000, 250 * 2 ** attempt) *
              (0.5 + Math.max(0, Math.min(1, this.jitter())) / 2);
          if (Date.now() + backoff >= deadline) {
            throw new PyxisReadError('deadline');
          }

          this.retries.add(1, {
            sourceInstance: this.sourceInstance,
            operation,
            reason: failure.code,
          });
          await delay(backoff, undefined, { signal }).catch(() => {
            throw new PyxisReadError('cancelled');
          });
        } finally {
          this.requests.add(1, {
            sourceInstance: this.sourceInstance,
            operation,
            outcome,
          });
          this.latency.record((Date.now() - started) / 1000, {
            sourceInstance: this.sourceInstance,
            operation,
          });
        }
      }
    } finally {
      release();
    }
  }

  private async page<T>(
    kind: Kind,
    input: PageRequest,
  ): Promise<SourcePage<T>> {
    if (
      !Number.isInteger(input.page) ||
      input.page < 0 ||
      !Number.isInteger(input.pageSize) ||
      input.pageSize < 1 ||
      input.pageSize > 500
    ) {
      throw new PyxisReadError('validation');
    }

    const filter =
      kind !== 'team' && input.filter !== 'all'
        ? {
            or: [
              { vendor_label: { eq: 'redhat' } },
              { vendor_label: { eq: null } },
            ],
          }
        : {};

    const response = await this.execute(
      kind,
      true,
      { page: input.page, pageSize: input.pageSize, filter },
      input,
    );

    const parsed = pageSchema.safeParse(response);
    if (!parsed.success) {
      throw new PyxisReadError('validation');
    }

    const data = z.array(sourceSchemas[kind]).safeParse(parsed.data.data);
    if (!data.success) {
      throw new PyxisReadError('validation');
    }

    return {
      data: data.data as T[],
      page: parsed.data.page,
      pageSize: parsed.data.page_size,
      total: parsed.data.total,
    };
  }

  private async lookup<T>(
    kind: Kind,
    id: string,
    options: ReadOptions,
  ): Promise<Lookup<T>> {
    if (!isObjectId(id)) {
      throw new PyxisReadError('validation');
    }

    const response = await this.execute(
      kind,
      false,
      { id: canonicalId(id) },
      options,
    );
    if (response.notFound) {
      return { state: 'not-found', authority: 'internal-source-404' };
    }

    const parsed = sourceSchemas[kind].safeParse(response.data);
    if (!parsed.success || parsed.data._id !== canonicalId(id)) {
      throw new PyxisReadError('validation');
    }

    return { state: 'found', data: parsed.data as T };
  }

  listListings(input: PageRequest): Promise<SourcePage<SourceListing>> {
    return this.page('listing', input);
  }

  listRepositories(input: PageRequest): Promise<SourcePage<SourceRepository>> {
    return this.page('repository', input);
  }

  listTeams(input: TeamPageRequest): Promise<SourcePage<SourceTeam>> {
    return this.page('team', input);
  }

  getListing(id: string, options: ReadOptions): Promise<Lookup<SourceListing>> {
    return this.lookup('listing', id, options);
  }

  getRepository(
    id: string,
    options: ReadOptions,
  ): Promise<Lookup<SourceRepository>> {
    return this.lookup('repository', id, options);
  }

  getTeam(id: string, options: ReadOptions): Promise<Lookup<SourceTeam>> {
    return this.lookup('team', id, options);
  }
}

/** Traverse all offset pages and reject incoherent or exhausted snapshots. @public */
export async function readAllPages<T extends { _id: string }>(
  read: (input: PageRequest) => Promise<SourcePage<T>>,
  limits: Pick<PyxisSourceConfig, 'pageSize' | 'maxPages' | 'maxRecords'>,
  options: ReadOptions,
): Promise<{ records: T[]; pages: number }> {
  const records = new Map<string, T>();
  let total: number | undefined;
  let fetched = 0;

  for (let page = 0; page < limits.maxPages; page += 1) {
    checkRead(options);
    const result = await read({
      ...options,
      page,
      pageSize: limits.pageSize,
      filter: 'candidates',
    });
    if (
      result.page !== page ||
      result.pageSize !== limits.pageSize ||
      (total !== undefined && total !== result.total) ||
      result.data.length > limits.pageSize
    ) {
      throw new PyxisReadError('pagination');
    }

    total = result.total;
    if (total >= limits.maxRecords) {
      throw new PyxisReadError('limit');
    }

    const expected = Math.min(
      limits.pageSize,
      Math.max(0, total - page * limits.pageSize),
    );
    if (result.data.length !== expected) {
      throw new PyxisReadError('pagination');
    }

    for (const record of result.data) {
      const previous = records.get(record._id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(record)) {
        throw new PyxisReadError('pagination');
      }

      records.set(record._id, record);
    }

    fetched += result.data.length;
    if (fetched >= total) {
      if (page + 1 >= limits.maxPages) {
        throw new PyxisReadError('limit');
      }
      if (records.size !== total) {
        throw new PyxisReadError('pagination');
      }

      return { records: [...records.values()], pages: page + 1 };
    }
  }

  throw new PyxisReadError('limit');
}
