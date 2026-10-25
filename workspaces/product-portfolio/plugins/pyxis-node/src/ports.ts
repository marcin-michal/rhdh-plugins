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
  ReadEnvelope,
  SourceKey,
} from '@red-hat-developer-hub/backstage-plugin-product-portfolio-common';
import type {
  HostIdentityBinding,
  InventorySnapshot,
  RepositoryChiSnapshot,
  SourceListing,
  SourceRepository,
  SourceTeam,
  VendorEvidence,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-common';

/** Cancellation and absolute deadline apply to the entire read. @public */
export interface ReadOptions {
  signal?: AbortSignal;
  deadline?: number;
}

/** Supported typed candidate filters; arbitrary query strings are not accepted. @public */
export interface PageRequest extends ReadOptions {
  page: number;
  pageSize: number;
  filter?: 'candidates' | 'all';
}

/** Listing traversal request. @public */
export type ListingPageRequest = PageRequest;

/** Independent repository traversal request. @public */
export type RepositoryPageRequest = PageRequest;

/** Team traversal request. @public */
export type TeamPageRequest = Omit<PageRequest, 'filter'>;

/** Validated offset page. @public */
export interface SourcePage<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** Only a structured source response establishes not-found. @public */
export type Lookup<T> =
  | { state: 'found'; data: T }
  | { state: 'not-found'; authority: 'internal-source-404' };

/** Read-only Pyxis transport contract. @public */
export interface PyxisReadClient {
  listListings(request: ListingPageRequest): Promise<SourcePage<SourceListing>>;
  listRepositories(
    request: RepositoryPageRequest,
  ): Promise<SourcePage<SourceRepository>>;
  listTeams(request: TeamPageRequest): Promise<SourcePage<SourceTeam>>;
  getListing(id: string, options: ReadOptions): Promise<Lookup<SourceListing>>;
  getRepository(
    id: string,
    options: ReadOptions,
  ): Promise<Lookup<SourceRepository>>;
  getTeam(id: string, options: ReadOptions): Promise<Lookup<SourceTeam>>;
  close(): Promise<void>;
}

/** Minimal repository metadata needed to select and mask CHI. @public */
export interface RepositoryChiContext {
  id: string;
  registry: string;
  repository: string;
  vendor: Pick<VendorEvidence, 'wirePresence' | 'wireValue'>;
  published: boolean | null;
  hiddenUntil: string | null;
  sourceUpdatedAt: string | null;
  contentStreamTags: readonly string[] | null;
  includesMultipleContentStreams: boolean | null;
}

/** Minimal repository association on an image candidate. @public */
export interface ChiCandidate {
  _id: string;
  architecture: string | null;
  deleted: boolean | null;
  repositories: readonly {
    registry: string;
    repository: string;
    published: boolean | null;
    push_date: string | null;
    tags: readonly {
      name: string;
      added_date: string | null;
      removed_date: string | null;
    }[];
  }[];
}

/** Validated keyset page from the repository-specific image query. @public */
export interface ChiCandidatePage {
  data: readonly ChiCandidate[];
  page: 0;
  pageSize: number;
}

/** Minimal selected-image identity plus optional raw grade periods. @public */
export interface SelectedImageChi extends ChiCandidate {
  repositories: readonly (ChiCandidate['repositories'][number] & {
    published_date: string | null;
    manifest_schema2_digest: string | null;
    manifest_list_digest: string | null;
  })[];
  freshness_grades?: unknown;
}

/** Narrow CHI transport implemented by the shared source client. @public */
export interface PyxisChiReadClient {
  getRepositoryChiContext(
    id: string,
    options: ReadOptions,
  ): Promise<Lookup<RepositoryChiContext>>;
  listRepositoryChiCandidates(
    request: ReadOptions & {
      registry: string;
      repository: string;
      streams: readonly string[];
      afterId?: string;
      pageSize: number;
    },
  ): Promise<ChiCandidatePage>;
  getSelectedImageChi(
    id: string,
    options: ReadOptions & { includeGrades: boolean },
  ): Promise<Lookup<SelectedImageChi>>;
}

/** Result of a complete read or a conservative failed observation. @public */
export type RepositoryChiReadResult =
  | { state: 'complete'; snapshot: RepositoryChiSnapshot }
  | {
      state: 'unavailable';
      attemptedAt: string;
      code: import('@red-hat-developer-hub/backstage-plugin-pyxis-common').ChiFailureCode;
      suppression?: { hiddenUntil: string; observedAt: string };
    };

/** Repository snapshot acquisition port. @public */
export interface PyxisChiReadPort {
  readRepository(
    source: SourceKey<'repository'>,
    options: ReadOptions,
  ): Promise<RepositoryChiReadResult>;
}

/** Restricted ingestion port; not an end-user authorization bypass. @public */
export interface PyxisInventoryReadPort {
  scan(options: ReadOptions): Promise<ReadEnvelope<InventorySnapshot>>;
}

/** Verified host adapters may implement this without changing ingestion. @public */
export interface HostIdentityBindingResolver {
  resolve(
    users: readonly SourceKey<'user'>[],
    options: ReadOptions,
  ): Promise<ReadEnvelope<readonly HostIdentityBinding[]>>;
}
