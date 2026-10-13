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

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { SourceKey } from '@red-hat-developer-hub/backstage-plugin-product-portfolio-common';
import type {
  PyxisKind,
  SourceTeam,
  SourceListing,
  SourceRepository,
  TeamRosterSnapshot,
  VendorEvidence,
  VendorPolicy,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-common';

/** ObjectID endpoints accept only canonical 24-hex identifiers. @public */
export function isObjectId(id: string): boolean {
  return /^[a-fA-F0-9]{24}$/.test(id);
}

/** Canonicalize ObjectIDs, preserving every other identifier string exactly. @public */
export function canonicalId(id: string): string {
  return isObjectId(id) ? id.toLocaleLowerCase('en-US') : id;
}

function encodeHashToBase32(digest: NonSharedBuffer): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let bits = 0;
  let value = 0;
  let encoded = '';

  for (const byte of digest) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += alphabet[(value >>> bits) & 31];
    }
  }

  // SHA-256 always leaves one bit after 51 complete base32 symbols.
  encoded += alphabet[(value << (5 - bits)) & 31];

  return encoded;
}

/** Frozen v1 SHA-256 / unpadded RFC4648 base32 catalog naming. @public */
export function sourceName(source: SourceKey<PyxisKind>): string {
  const digest = createHash('sha256')
    .update(
      JSON.stringify([source.sourceInstance, source.kind, source.id]),
      'utf8',
    )
    .digest();

  const encoded = encodeHashToBase32(digest);

  return `${
    { listing: 'l', repository: 'r', team: 't', user: 'u' }[source.kind]
  }-${encoded}`;
}

export function sourceRef(source: SourceKey<PyxisKind>): string {
  const kind = {
    listing: 'resource',
    repository: 'resource',
    team: 'group',
    user: 'user',
  }[source.kind];

  return `${kind}:pyxis/${sourceName(source)}`;
}

export function classifyVendor(
  record: { vendor_label?: unknown },
  policy: VendorPolicy = 'redhat-only',
  storedPresence?: VendorEvidence['storedPresence'],
): VendorEvidence {
  const present = Object.hasOwn(record, 'vendor_label');
  const value = record.vendor_label;
  let classification: VendorEvidence['classification'] = 'unreadable';

  if (!present) {
    classification = 'missing';
  } else if (value === 'redhat') {
    classification = 'redhat';
  } else if (typeof value === 'string') {
    classification = 'other';
  } else if (value === null) {
    classification =
      storedPresence?.authority && storedPresence.version
        ? 'explicit-null'
        : 'null-or-missing';
  }

  let decision: VendorEvidence['decision'] = 'unresolved';
  if (
    classification === 'redhat' ||
    (policy === 'redhat-or-unlabeled' &&
      ['explicit-null', 'null-or-missing', 'missing'].includes(classification))
  ) {
    decision = 'admit';
  } else if (classification === 'other') {
    decision = 'exclude';
  }

  return {
    wirePresence: present ? 'present' : 'missing',
    ...(typeof value === 'string' || value === null
      ? { wireValue: value }
      : {}),
    ...(storedPresence ? { storedPresence } : {}),
    classification,
    decision,
    policy,
  };
}

const date = z.string().datetime({ offset: true });
const id = z.string().min(1).refine(isObjectId).transform(canonicalId);
const optionalString = z.string().nullable().optional();
const base = { _id: id, last_update_date: date.nullable().optional() };
const resource = {
  ...base,
  vendor_label: z.unknown(),
  team_id: optionalString,
  published: z.boolean().nullable().optional(),
};

/** Minimal source schemas discard fields outside the selected projection. @public */
export const sourceSchemas = {
  listing: z.object({
    ...resource,
    name: optionalString,
    deleted: z.boolean().nullable().optional(),
    repositories: z.array(id).nullable().optional(),
  }),
  repository: z.object({
    ...resource,
    registry: optionalString,
    repository: optionalString,
    display_data: z.object({ name: optionalString }).nullable().optional(),
    product_listings: z.array(id).nullable().optional(),
  }),
  team: z.object({ ...base, name: optionalString, members: z.unknown() }),
};

const memberSchema = z.object({
  user_id: z.string().min(1),
  role: optionalString,
  added_date: date.nullable().optional(),
});

/** Preserve partial evidence without turning a malformed roster into empty success. @public */
export function normalizeRoster(
  sourceInstance: string,
  team: SourceTeam,
  observedAt: string,
): TeamRosterSnapshot {
  const members: TeamRosterSnapshot['members'][number][] = [];
  const seen = new Map<string, string>();
  let completeness: TeamRosterSnapshot['completeness'] = Array.isArray(
    team.members,
  )
    ? 'complete'
    : 'unavailable';

  if (Array.isArray(team.members)) {
    for (const raw of team.members) {
      const parsed = memberSchema.safeParse(raw);
      if (!parsed.success) {
        completeness = 'partial';
        continue;
      }

      const member = parsed.data;
      const fingerprint = JSON.stringify(member);

      if (seen.has(member.user_id)) {
        if (seen.get(member.user_id) !== fingerprint) {
          completeness = 'partial';
        }
        continue;
      }

      seen.set(member.user_id, fingerprint);
      members.push({
        user: { sourceInstance, kind: 'user', id: member.user_id },
        ...(member.role ? { role: member.role } : {}),
        ...(member.added_date ? { addedDate: member.added_date } : {}),
      });
    }
  }

  return {
    team: { sourceInstance, kind: 'team', id: team._id },
    members,
    observedAt,
    ...(team.last_update_date
      ? { sourceUpdatedAt: team.last_update_date }
      : {}),
    completeness,
    organizationalCurrency: 'unverified',
  };
}

/** Validate a minimal source projection, discarding unrequested fields. @public */
export function parseSourceRecord(
  kind: 'listing' | 'repository' | 'team',
  value: unknown,
): SourceListing | SourceRepository | SourceTeam {
  return sourceSchemas[kind].parse(value);
}
