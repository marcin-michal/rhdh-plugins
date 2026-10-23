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

import type {
  AssociationSet,
  CatalogBinding,
  ReadMetadata,
  SourceKey,
} from '@red-hat-developer-hub/backstage-plugin-product-portfolio-common';

export * from './chi';
export * from './chiSummary';

/** Catalog source kinds @public */
export type PyxisKind = 'listing' | 'repository' | 'team' | 'user';

/** Provider-selected admission policy, independent of source transport. @public */
export type VendorPolicy = 'redhat-only' | 'redhat-or-unlabeled';

/** Wire evidence never proves stored presence on its own. @public */
export interface VendorEvidence {
  wirePresence: 'present' | 'missing';
  wireValue?: string | null;
  storedPresence?: { authority: string; version: string; value: null };
  classification:
    | 'redhat'
    | 'other'
    | 'explicit-null'
    | 'null-or-missing'
    | 'missing'
    | 'unreadable';
  decision: 'admit' | 'exclude' | 'unresolved';
  policy: VendorPolicy;
}

/** Minimal validated listing projection. @public */
export interface SourceListing {
  _id: string;
  name?: string | null;
  vendor_label?: unknown;
  team_id?: string | null;
  repositories?: string[] | null;
  published?: boolean | null;
  deleted?: boolean | null;
  contacts?:
    | {
        email_address?: string | null;
        type?: string | null;
      }[]
    | null;
  descriptions?: { long: string; short: string } | null;
  logo?: { url?: string | null } | null;
  support?: {
    description?: string | null;
    email_address?: string | null;
    phone_number?: string | null;
    url: string;
  } | null;
  /** Pyxis source creation time, separate from Backstage entity metadata. */
  creation_date?: string | null;
  /** Pyxis source update time, separate from Backstage entity metadata. */
  last_update_date?: string | null;
}

/** Minimal validated repository projection @public */
export interface SourceRepository {
  _id: string;
  vendor_label?: unknown;
  registry?: string | null;
  repository?: string | null;
  display_data?: {
    name?: string | null;
    long_description: string;
    short_description: string;
  } | null;
  team_id?: string | null;
  product_listings?: string[] | null;
  published?: boolean | null;
  release_categories?: string[] | null;
  architectures?: string[] | null;
  documentation_links?:
    | {
        title: string;
        type: string;
        url: string;
      }[]
    | null;
  metrics?: {
    last_update_date?: string | null;
    pulls_in_last_30_days?: number | null;
  } | null;
  contacts?:
    | {
        email_address: string;
        type: string;
      }[]
    | null;
  /** Pyxis source creation time, separate from Backstage entity metadata. */
  creation_date?: string | null;
  /** Pyxis source update time, separate from Backstage entity metadata. */
  last_update_date?: string | null;
}

/** @public */
export interface SourceMember {
  user_id: string;
  role?: string | null;
  added_date?: string | null;
}

/** Missing or malformed members imply incomplete roster evidence. @public */
export interface SourceTeam {
  _id: string;
  name?: string | null;
  members?: unknown;
  last_update_date?: string | null;
}

/** @public */
export interface TeamRosterSnapshot {
  team: SourceKey<'team'>;
  members: readonly {
    user: SourceKey<'user'>;
    role?: string;
    addedDate?: string;
  }[];
  observedAt: string;
  sourceUpdatedAt?: string;
  completeness: 'complete' | 'partial' | 'unavailable';
  organizationalCurrency: 'unverified';
}

/** @public */
export interface HostIdentityBinding {
  source: SourceKey<'user'>;
  hostRef?: string;
  state: 'matched' | 'unmatched' | 'ambiguous' | 'stale';
  authority: string;
  version: string;
  observedAt: string;
}

/** Admission and projection evidence for a fetched source resource. @public */
export interface InventoryResource<
  T extends SourceListing | SourceRepository = SourceListing | SourceRepository,
> {
  source: SourceKey<'listing' | 'repository'>;
  record: T;
  vendor: VendorEvidence;
  binding: CatalogBinding;
  ownership: 'resolved-id' | 'unresolved-opaque' | 'unresolved-owner';
  associations?: AssociationSet;
}

/** Independent quality dimensions are preserved for future consumers. @public */
export interface InventorySnapshot {
  listings: InventoryResource<SourceListing>[];
  repositories: InventoryResource<SourceRepository>[];
  teams: { record: SourceTeam; roster: TeamRosterSnapshot }[];
  notFound: SourceKey[];
  quality: {
    fetch: 'complete' | 'incomplete';
    admission: 'complete' | 'partial';
    associations: 'complete' | 'partial';
    rosters: 'complete' | 'partial';
    projection: 'complete' | 'partial';
  };
}

/** Versioned, provider-owned DTO persisted in spec.pyxis. @public */
export interface PyxisProjection {
  version: '1';
  source: SourceKey<PyxisKind>;
  observation: ReadMetadata;
  record?: SourceListing | SourceRepository | SourceTeam;
  vendor?: VendorEvidence;
  ownership?: InventoryResource['ownership'];
  associations?: AssociationSet;
  roster?: TeamRosterSnapshot;
  memberships?: readonly {
    team: SourceKey<'team'>;
    role?: string;
    addedDate?: string;
  }[];
}
