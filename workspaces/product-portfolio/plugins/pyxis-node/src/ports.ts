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
  SourceListing,
  SourceRepository,
  SourceTeam,
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
