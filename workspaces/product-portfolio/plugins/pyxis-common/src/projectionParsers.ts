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

import { z } from 'zod';
import type { PyxisProjection } from './index';
import type { RepositoryChiProjection } from './chi';

/** Safe contract failure: never includes the raw provider payload. @public */
export class PyxisContractError extends Error {
  /** Expected contract and version. */
  readonly contract: 'spec.pyxis version 1' | 'spec.pyxisChi schema 2';
  constructor(contract: 'spec.pyxis version 1' | 'spec.pyxisChi schema 2') {
    super(`Invalid or unsupported ${contract}`);
    this.name = 'PyxisContractError';
    this.contract = contract;
  }
}

const keySchema = z
  .object({
    sourceInstance: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
    kind: z.enum(['listing', 'repository', 'team', 'user']),
    id: z.string().min(1),
  })
  .strict();
const metadataSchema = z
  .object({
    contractVersion: z.literal('1'),
    startedAt: z.string().datetime({ offset: true }),
    observedAt: z.string().datetime({ offset: true }),
    sourceUpdatedAt: z.string().datetime({ offset: true }).optional(),
    traversal: z
      .object({
        complete: z.boolean(),
        atomic: z.literal(false),
        pages: z.number().int().nonnegative(),
        records: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
const memberSchema = z
  .object({
    user: keySchema.extend({ kind: z.literal('user') }),
    role: z.string().optional(),
    addedDate: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
const rosterSchema = z
  .object({
    team: keySchema.extend({ kind: z.literal('team') }),
    members: z.array(memberSchema),
    observedAt: z.string().datetime({ offset: true }),
    sourceUpdatedAt: z.string().datetime({ offset: true }).optional(),
    completeness: z.enum(['complete', 'partial', 'unavailable']),
    organizationalCurrency: z.literal('unverified'),
  })
  .strict();
const associationSchema = z
  .object({
    subject: keySchema,
    authority: z.literal('pyxis:listing.repositories'),
    complete: z.boolean(),
    associations: z.array(
      z
        .object({
          target: keySchema.extend({ kind: z.literal('repository') }),
          entityRef: z.string().optional(),
          provenance: z.literal('direct-listing'),
          status: z.enum([
            'projected',
            'excluded-vendor',
            'admission-unresolved',
            'not-found',
            'projection-unresolved',
          ]),
        })
        .strict(),
    ),
    diagnostics: z.array(
      z
        .object({
          code: z.literal('inverse-association-discrepancy'),
          count: z.number().int().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict();
const vendorSchema = z
  .object({
    wirePresence: z.enum(['present', 'missing']),
    wireValue: z.string().nullable().optional(),
    storedPresence: z
      .object({
        authority: z.string().min(1),
        version: z.string().min(1),
        value: z.null(),
      })
      .strict()
      .optional(),
    classification: z.enum([
      'redhat',
      'other',
      'explicit-null',
      'null-or-missing',
      'missing',
      'unreadable',
    ]),
    decision: z.enum(['admit', 'exclude', 'unresolved']),
    policy: z.enum(['redhat-only', 'redhat-or-unlabeled']),
  })
  .strict();
const projectionSchema = z
  .object({
    version: z.literal('1'),
    source: keySchema,
    observation: metadataSchema,
    record: z.unknown().optional(),
    vendor: vendorSchema.optional(),
    ownership: z
      .enum(['resolved-id', 'unresolved-opaque', 'unresolved-owner'])
      .optional(),
    associations: associationSchema.optional(),
    roster: rosterSchema.optional(),
    memberships: z
      .array(
        z
          .object({
            team: keySchema.extend({ kind: z.literal('team') }),
            role: z.string().optional(),
            addedDate: z.string().datetime({ offset: true }).optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

const optionalString = z.string().nullable().optional();
const sourceId = z.string().regex(/^[a-f0-9]{24}$/);
const date = z.string().datetime({ offset: true });
const recordBase = {
  _id: sourceId,
  last_update_date: date.nullable().optional(),
};
const repositoryContactSchema = z.object({
  email_address: z.string(),
  type: z.enum([
    'Product Manager',
    'Image Owner',
    'Notification',
    'Errata Writer',
    'Doc Owner',
    'QE Owner',
    'Program Manager',
  ]),
});
const documentationLinkSchema = z.object({
  title: z.string(),
  type: z.enum([
    'Customer Case Study',
    'Documentation',
    'White Paper',
    'Blog',
    'Demo Video',
    'Product Datasheet',
    'Recorded Webinar',
    'Solution Brief',
  ]),
  url: z.string(),
});
const resource = {
  ...recordBase,
  creation_date: date.nullable().optional(),
  vendor_label: z.unknown(),
  team_id: optionalString,
  published: z.boolean().nullable().optional(),
};
const records = {
  listing: z.object({
    ...resource,
    name: optionalString,
    deleted: z.boolean().nullable().optional(),
    repositories: z.array(sourceId).nullable().optional(),
    descriptions: z
      .object({ long: z.string(), short: z.string() })
      .nullable()
      .optional(),
    contacts: z
      .array(
        z.object({
          email_address: optionalString,
          type: optionalString,
        }),
      )
      .nullable()
      .optional(),
    logo: z.object({ url: optionalString }).nullable().optional(),
    support: z
      .object({
        description: optionalString,
        email_address: optionalString,
        phone_number: optionalString,
        url: z.string(),
      })
      .nullable()
      .optional(),
  }),
  repository: z.object({
    ...resource,
    registry: optionalString,
    repository: optionalString,
    display_data: z
      .object({
        name: optionalString,
        long_description: z.string(),
        short_description: z.string(),
      })
      .nullable()
      .optional(),
    product_listings: z.array(sourceId).nullable().optional(),
    release_categories: z
      .array(
        z.enum([
          'Generally Available',
          'Beta',
          'Tech Preview',
          'Deprecated',
          'Mixed',
        ]),
      )
      .nullable()
      .optional(),
    architectures: z.array(z.string()).nullable().optional(),
    documentation_links: z.array(documentationLinkSchema).nullable().optional(),
    metrics: z
      .object({
        last_update_date: date.nullable().optional(),
        pulls_in_last_30_days: z.number().int().nullable().optional(),
      })
      .nullable()
      .optional(),
    contacts: z.array(repositoryContactSchema).nullable().optional(),
  }),
  team: z.object({ ...recordBase, name: optionalString, members: z.unknown() }),
};

/** Validate the persisted v1 projection without importing a source client. @public */
export function parsePyxisProjection(value: unknown): PyxisProjection {
  const parsed = projectionSchema.safeParse(value);
  if (!parsed.success) throw new PyxisContractError('spec.pyxis version 1');
  const p = parsed.data;
  const kind = p.source.kind;
  const fail = () => {
    throw new PyxisContractError('spec.pyxis version 1');
  };
  if (kind !== 'user') {
    const record = records[kind].safeParse(p.record);
    if (!record.success || record.data._id !== p.source.id) return fail();
    p.record = record.data;
  } else if (p.record !== undefined) return fail();
  const local = (key: { sourceInstance: string }) =>
    key.sourceInstance === p.source.sourceInstance;
  if (
    p.roster &&
    (kind !== 'team' ||
      !local(p.roster.team) ||
      p.roster.team.id !== p.source.id ||
      p.roster.members.some(m => !local(m.user)))
  )
    return fail();
  if (
    p.memberships &&
    (kind !== 'user' || p.memberships.some(m => !local(m.team)))
  )
    return fail();
  if (
    p.associations &&
    (kind !== 'listing' ||
      p.associations.subject.id !== p.source.id ||
      p.associations.subject.kind !== kind ||
      !local(p.associations.subject) ||
      p.associations.associations.some(a => !local(a.target)))
  )
    return fail();
  if (
    (kind === 'team' && !p.roster) ||
    (kind === 'user' && !p.memberships) ||
    ((kind === 'listing' || kind === 'repository') &&
      (!p.vendor || !p.ownership))
  )
    return fail();
  return p as PyxisProjection;
}

const grade = z.enum(['A', 'B', 'C', 'D', 'E', 'F']);
const count = z.number().int().nonnegative();
const counts = z.object({
  total: count,
  byGrade: z.object({
    A: count,
    B: count,
    C: count,
    D: count,
    E: count,
    F: count,
    unknown: count,
  }),
  aWithScheduledDrop: count,
  byAttention: z.object({
    ok: count,
    warning: count,
    problem: count,
    unknown: count,
  }),
});
const drop = z.object({ from: grade, to: grade, at: date });
const issue = z.enum([
  'streams-not-configured',
  'no-published-candidate',
  'missing-expected-architecture',
  'invalid-architecture',
  'invalid-push-date',
  'invalid-tag-date',
  'conflicting-association',
  'tied-latest',
]);
const image = z.object({
  imageId: z.string().min(1),
  architecture: z.string().min(1),
  selectedIn: z.array(z.string()),
  pushDates: z.record(date),
  activeTags: z.array(z.string().min(1)),
  manifestDigest: z.string().min(1).max(256).nullable(),
  manifestListDigest: z.string().min(1).max(256).nullable(),
  publishedAt: date.nullable(),
  currentGrade: grade.nullable(),
  gradeOrigin: z.literal('normalized-source-periods'),
  gradeQuality: z.enum(['known', 'unknown', 'inconsistent', 'hidden']),
  periodEvidence: z.enum(['valid', 'absent', 'inconsistent', 'hidden']),
  periods: z.array(
    z.object({
      grade,
      startAt: date,
      endAt: date.nullable(),
      createdAt: date.nullable(),
    }),
  ),
  futureDrops: z.array(drop),
  attention: z.enum(['ok', 'warning', 'problem', 'unknown']),
});
const stream = z.object({
  tag: z.string(),
  architectures: z.object({
    basis: z.enum(['configured', 'observed-only']),
    expected: z.array(z.string()).nullable(),
    observed: z.array(z.string()),
    missing: z.array(z.string()),
  }),
  slots: z.array(
    z.object({
      architecture: z.string(),
      state: z.enum(['selected', 'missing', 'uncertain']),
      imageId: z.string().nullable(),
      pushDate: date.nullable(),
      reason: issue.nullable(),
    }),
  ),
  issues: z.array(issue),
  counts,
  worstKnownGrade: grade.nullable(),
  earliestDrop: drop
    .extend({ imageId: z.string(), architecture: z.string() })
    .nullable(),
});
const snapshot = z.object({
  schemaVersion: z.literal('2'),
  normalizationVersion: z.literal('pyxis-chi-v2'),
  population: z.literal('latest-published-per-stream-architecture'),
  source: keySchema.extend({ kind: z.literal('repository') }),
  locator: z.object({ registry: z.string(), repository: z.string() }),
  streamPolicy: z.object({
    tags: z.array(z.string()),
    origin: z.enum(['configured', 'latest-fallback', 'unconfigured']),
    includesMultipleContentStreams: z.boolean().nullable(),
  }),
  startedAt: date,
  selectionAt: date,
  observedAt: date,
  contextCheckedAt: date,
  sourceUpdatedAt: date.nullable(),
  sourceCalculationFreshness: z.literal('unknown'),
  hiddenUntil: date.nullable(),
  published: z.boolean().nullable(),
  coverage: z.object({
    fetch: z.literal('complete'),
    atomic: z.literal(false),
    allRepositoryImages: z.literal(false),
    selection: z.enum(['complete', 'partial']),
    architectureExpectations: z.enum(['verified', 'unverified']),
    grades: z.enum(['complete', 'partial', 'hidden']),
    candidatePages: count,
    candidateRecords: count,
  }),
  issues: z.array(issue),
  contentHash: z.string().min(1),
  streams: z.array(stream),
  images: z.array(image),
  counts,
});
const chiSchema = z.object({
  schemaVersion: z.literal('2'),
  enabled: z.boolean(),
  staleAfterSeconds: z.number().positive(),
  state: z.enum([
    'ready',
    'partial',
    'empty',
    'hidden',
    'unavailable',
    'disabled',
  ]),
  lastAttempt: z
    .object({
      at: date,
      outcome: z.enum(['complete', 'failed']),
      code: z
        .enum([
          'authorization',
          'transport',
          'timeout',
          'cancelled',
          'graphql',
          'source',
          'source-not-found',
          'validation',
          'context-changed',
          'selection-changed',
          'source-ineligible',
          'pagination',
          'limit',
          'cache-invalid',
        ])
        .optional(),
    })
    .nullable(),
  suppression: z.object({ hiddenUntil: date, observedAt: date }).nullable(),
  snapshot: snapshot.nullable(),
});

/** Validate every displayed nested field in repository health schema 2. @public */
export function parseRepositoryChiProjection(
  value: unknown,
): RepositoryChiProjection {
  const parsed = chiSchema.safeParse(value);
  if (!parsed.success) throw new PyxisContractError('spec.pyxisChi schema 2');
  const p = parsed.data;
  if (
    (['ready', 'partial', 'empty'].includes(p.state) && !p.snapshot) ||
    (p.state === 'disabled' && (p.enabled || p.snapshot !== null))
  )
    throw new PyxisContractError('spec.pyxisChi schema 2');
  return p;
}
