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
  getCompoundEntityRef,
  stringifyEntityRef,
  type Entity,
} from '@backstage/catalog-model';
import type { JsonObject } from '@backstage/types';
import { z } from 'zod';
import type { PyxisProjection } from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import {
  canonicalId,
  sourceName,
  sourceRef,
  parseSourceRecord,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-node';

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

export function providerId(sourceInstance: string): string {
  return `pyxis-provider:${sourceInstance}`;
}

/** Validates persisted DTOs before using them for restart preservation. */
export function parseProjection(value: unknown): PyxisProjection {
  const parsed = projectionSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error('pyxis-invalid-projection');
  }

  const p = parsed.data;
  const kind = p.source.kind;

  if (kind !== 'user') {
    try {
      const record = parseSourceRecord(kind, p.record);
      if (record._id !== p.source.id) {
        throw new Error('mismatched-source-id');
      }

      p.record = record;
    } catch {
      throw new Error('pyxis-invalid-projection-record');
    }
  }

  const local = (key: { sourceInstance: string }) =>
    key.sourceInstance === p.source.sourceInstance;

  if (
    p.roster &&
    (!local(p.roster.team) ||
      p.roster.team.id !== p.source.id ||
      p.roster.members.some(member => !local(member.user)))
  ) {
    throw new Error('pyxis-invalid-roster-scope');
  }

  if (p.memberships?.some(member => !local(member.team))) {
    throw new Error('pyxis-invalid-membership-scope');
  }

  if (
    p.associations &&
    (JSON.stringify(p.associations.subject) !== JSON.stringify(p.source) ||
      p.associations.associations.some(
        a =>
          !local(a.target) ||
          (a.entityRef !== undefined && a.entityRef !== sourceRef(a.target)),
      ))
  ) {
    throw new Error('pyxis-invalid-association-scope');
  }

  if (
    (kind === 'team' && !p.roster) ||
    (kind === 'user' && !p.memberships) ||
    ((kind === 'listing' || kind === 'repository') &&
      (!p.vendor || !p.ownership))
  ) {
    throw new Error('pyxis-incomplete-projection');
  }

  return p as PyxisProjection;
}

/** Build only provider-owned fields; never resubmit uid, status, or relations. */
export function projectEntity(projection: PyxisProjection): Entity {
  const p = parseProjection(projection);
  const { source } = p;
  let title: string | undefined;
  let spec: JsonObject;

  if (source.kind === 'listing' || source.kind === 'repository') {
    const record = p.record as NonNullable<PyxisProjection['record']> & {
      team_id?: string | null;
      display_data?: { name?: string | null } | null;
      repository?: string | null;
      name?: string | null;
    };

    if (!record.team_id || p.ownership === 'unresolved-owner') {
      throw new Error('pyxis-unresolved-owner');
    }

    title =
      source.kind === 'listing'
        ? record.name ?? undefined
        : record.display_data?.name ?? record.repository ?? undefined;
    spec = {
      type:
        source.kind === 'listing'
          ? 'pyxis-product-listing'
          : 'container-repository',
      owner: sourceRef({
        sourceInstance: source.sourceInstance,
        kind: 'team',
        id: canonicalId(record.team_id),
      }),
    };

    // Vendor evidence carries only a bounded wire projection, not arbitrary input.
    if (
      'vendor_label' in record &&
      typeof record.vendor_label !== 'string' &&
      record.vendor_label !== null
    ) {
      delete record.vendor_label;
    }
  } else if (source.kind === 'team') {
    title = (p.record as { name?: string | null }).name ?? undefined;
    // Store only validated roster entries, never the raw embedded upstream object.
    p.record = {
      _id: source.id,
      ...(title ? { name: title } : {}),
      ...(p.roster!.sourceUpdatedAt
        ? { last_update_date: p.roster!.sourceUpdatedAt }
        : {}),
      members: p.roster!.members.map(member => ({
        user_id: member.user.id,
        ...(member.role ? { role: member.role } : {}),
        ...(member.addedDate ? { added_date: member.addedDate } : {}),
      })),
    };
    spec = {
      type: 'team',
      children: [],
      members: p.roster!.members.map(member => sourceRef(member.user)),
    };
  } else {
    spec = { memberOf: p.memberships!.map(member => sourceRef(member.team)) };
  }

  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: {
      team: 'Group',
      user: 'User',
      listing: 'Resource',
      repository: 'Resource',
    }[source.kind],
    metadata: {
      name: sourceName(source),
      namespace: 'pyxis',
      ...(title ? { title } : {}),
      annotations: {
        'backstage.io/managed-by-location': `pyxis:${source.sourceInstance}/${
          source.kind
        }/${encodeURIComponent(source.id)}`,
        'backstage.io/managed-by-origin-location': `pyxis:${source.sourceInstance}`,
        'pyxis.redhat.com/source-instance': source.sourceInstance,
        'pyxis.redhat.com/source-kind': source.kind,
        'pyxis.redhat.com/source-id': source.id,
        'pyxis.redhat.com/provider-id': providerId(source.sourceInstance),
        'pyxis.redhat.com/projection-version': '1',
      },
    },
    spec: { ...spec, pyxis: JSON.parse(JSON.stringify(p)) as JsonObject },
  };
}

export function ownedProjection(
  entity: Entity,
  sourceInstance: string,
): PyxisProjection {
  const p = parseProjection(entity.spec?.pyxis);
  const expected = projectEntity(p);
  const annotations = entity.metadata.annotations;

  if (
    p.source.sourceInstance !== sourceInstance ||
    stringifyEntityRef(entity) !== sourceRef(p.source) ||
    entity.metadata.namespace !== 'pyxis' ||
    Object.entries(expected.metadata.annotations!).some(
      ([key, value]) => annotations?.[key] !== value,
    )
  ) {
    throw new Error('pyxis-projection-conflict');
  }

  return p;
}

export const compoundRef = (p: PyxisProjection) =>
  getCompoundEntityRef(projectEntity(p));
