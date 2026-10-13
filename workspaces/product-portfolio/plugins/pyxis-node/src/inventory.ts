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
  ReadEnvelope,
  SourceKey,
} from '@red-hat-developer-hub/backstage-plugin-product-portfolio-common';
import type {
  InventoryResource,
  InventorySnapshot,
  PyxisKind,
  SourceListing,
  SourceRepository,
  VendorPolicy,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import type { PyxisSourceConfig } from './config';
import type {
  PyxisInventoryReadPort,
  PyxisReadClient,
  ReadOptions,
} from './ports';
import { checkRead, PyxisReadError, readAllPages } from './client';
import {
  canonicalId,
  classifyVendor,
  isObjectId,
  normalizeRoster,
  sourceRef,
} from './normalization';

type ScanStage =
  | 'listings'
  | 'repositories'
  | 'limits'
  | 'tracked-listing'
  | 'tracked-repository'
  | 'relationships'
  | 'teams'
  | 'finalize';

const MAX_DIAGNOSTIC_DURATION_MS = 86_400_000;

/** Complete guarded inventory traversal for one source instance. @public */
export class PyxisInventoryReader implements PyxisInventoryReadPort {
  constructor(
    private readonly sourceInstance: string,
    private readonly client: PyxisReadClient,
    private readonly limits: Pick<
      PyxisSourceConfig,
      'pageSize' | 'maxPages' | 'maxRecords'
    >,
    private readonly tracked: readonly SourceKey<PyxisKind>[] = [],
    private readonly vendorPolicy: VendorPolicy = 'redhat-only',
  ) {}

  async scan(options: ReadOptions): Promise<ReadEnvelope<InventorySnapshot>> {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    let pages = 0;
    let records = 0;
    let stage: ScanStage = 'listings';

    const metadata = () => ({
      contractVersion: '1' as const,
      startedAt,
      observedAt: new Date().toISOString(),
      traversal: { complete: false, atomic: false as const, pages, records },
    });

    try {
      const listings = await readAllPages(
        request => this.client.listListings(request),
        this.limits,
        options,
      );
      pages += listings.pages;
      records += listings.records.length;

      stage = 'repositories';
      const repositories = await readAllPages(
        request => this.client.listRepositories(request),
        this.limits,
        options,
      );
      pages += repositories.pages;
      records += repositories.records.length;

      stage = 'limits';
      if (records >= this.limits.maxRecords || pages >= this.limits.maxPages) {
        throw new PyxisReadError('limit');
      }

      const listingMap = new Map(
        listings.records.map(record => [record._id, record]),
      );
      const repositoryMap = new Map(
        repositories.records.map(record => [record._id, record]),
      );
      const notFound: SourceKey[] = [];

      const lookup = async (kind: 'listing' | 'repository', id: string) => {
        stage = kind === 'listing' ? 'tracked-listing' : 'tracked-repository';
        checkRead(options);

        if (kind === 'listing') {
          const result = await this.client.getListing(id, options);
          if (result.state === 'found') {
            listingMap.set(id, result.data);
          } else {
            notFound.push({ sourceInstance: this.sourceInstance, kind, id });
          }
        } else {
          const result = await this.client.getRepository(id, options);
          if (result.state === 'found') {
            repositoryMap.set(id, result.data);
          } else {
            notFound.push({ sourceInstance: this.sourceInstance, kind, id });
          }
        }

        records += 1;
        if (records >= this.limits.maxRecords) {
          throw new PyxisReadError('limit');
        }
      };

      for (const key of this.tracked) {
        if (key.kind === 'listing' && !listingMap.has(key.id))
          await lookup('listing', key.id);
        if (key.kind === 'repository' && !repositoryMap.has(key.id))
          await lookup('repository', key.id);
      }

      const missingRepositoryIds = new Set(
        [...listingMap.values()]
          .flatMap(listing => listing.repositories ?? [])
          .filter(
            id =>
              !repositoryMap.has(id) &&
              !notFound.some(key => key.kind === 'repository' && key.id === id),
          ),
      );

      for (const id of missingRepositoryIds) {
        await lookup('repository', id);
      }

      stage = 'relationships';
      const mappedListings = [...listingMap.values()].map(record =>
        this.resource('listing', record),
      );
      const mappedRepositories = [...repositoryMap.values()].map(record =>
        this.resource('repository', record),
      );
      const mappedRepositoryMap = new Map(
        mappedRepositories.map(item => [item.source.id, item]),
      );

      for (const listing of mappedListings) {
        const associations: AssociationSet = {
          subject: listing.source,
          authority: 'pyxis:listing.repositories',
          complete: Array.isArray(listing.record.repositories),
          diagnostics: [],
          associations: (listing.record.repositories ?? []).map(id => {
            const target = {
              sourceInstance: this.sourceInstance,
              kind: 'repository' as const,
              id,
            };

            const repository = mappedRepositoryMap.get(id);
            let status: AssociationSet['associations'][number]['status'] =
              'not-found';

            if (repository) {
              if (repository.vendor.decision === 'exclude') {
                status = 'excluded-vendor';
              } else if (repository.vendor.decision === 'unresolved') {
                status = 'admission-unresolved';
              } else {
                status =
                  repository.binding.status === 'projected'
                    ? 'projected'
                    : 'projection-unresolved';
              }
            }

            return {
              target,
              provenance: 'direct-listing' as const,
              status,
              ...(status === 'projected'
                ? { entityRef: sourceRef(target) }
                : {}),
            };
          }),
        };

        const inverseMismatch = mappedRepositories.filter(
          repository =>
            (repository.record.product_listings ?? []).includes(
              listing.source.id,
            ) !==
            (listing.record.repositories ?? []).includes(repository.source.id),
        ).length;

        if (inverseMismatch) {
          associations.diagnostics = [
            { code: 'inverse-association-discrepancy', count: inverseMismatch },
          ];
        }

        listing.associations = associations;
      }

      const teamIds = new Set(
        this.tracked.filter(key => key.kind === 'team').map(key => key.id),
      );
      for (const item of [...mappedListings, ...mappedRepositories]) {
        if (
          item.vendor.decision === 'admit' &&
          item.record.team_id &&
          isObjectId(item.record.team_id)
        ) {
          teamIds.add(canonicalId(item.record.team_id));
        }
      }

      stage = 'teams';
      const teams: InventorySnapshot['teams'] = [];
      for (const id of teamIds) {
        checkRead(options);
        const result = await this.client.getTeam(id, options);
        records += 1;

        if (records >= this.limits.maxRecords) {
          throw new PyxisReadError('limit');
        }

        if (result.state === 'not-found') {
          notFound.push({
            sourceInstance: this.sourceInstance,
            kind: 'team',
            id,
          });
          continue;
        }

        teams.push({
          record: result.data,
          roster: normalizeRoster(
            this.sourceInstance,
            result.data,
            new Date().toISOString(),
          ),
        });
      }

      stage = 'finalize';
      checkRead(options);
      const resources = [...mappedListings, ...mappedRepositories];
      const data: InventorySnapshot = {
        listings: mappedListings,
        repositories: mappedRepositories,
        teams,
        notFound,
        quality: {
          fetch: 'complete',
          admission: resources.some(
            item => item.vendor.decision === 'unresolved',
          )
            ? 'partial'
            : 'complete',
          associations: mappedListings.some(
            item =>
              !item.associations?.complete ||
              item.associations.associations.some(
                a => a.status !== 'projected',
              ),
          )
            ? 'partial'
            : 'complete',
          rosters:
            teams.some(team => team.roster.completeness !== 'complete') ||
            notFound.some(key => key.kind === 'team')
              ? 'partial'
              : 'complete',
          projection: resources.some(
            item =>
              item.vendor.decision === 'admit' &&
              item.binding.status !== 'projected',
          )
            ? 'partial'
            : 'complete',
        },
      };

      return {
        ...metadata(),
        traversal: { complete: true, atomic: false, pages, records },
        state: 'complete',
        data,
      };
    } catch (error) {
      const diagnosticDuration = Math.min(
        MAX_DIAGNOSTIC_DURATION_MS,
        Math.max(0, Date.now() - started),
      );
      return {
        ...metadata(),
        state: 'unavailable',
        diagnostics: [
          {
            code:
              error instanceof PyxisReadError ? error.code : 'inventory-failed',
            operation: 'inventory-scan',
            stage,
            retryable: error instanceof PyxisReadError && error.retryable,
            durationMs: diagnosticDuration,
          },
        ],
      };
    }
  }

  private resource<
    K extends 'listing' | 'repository',
    T extends SourceListing | SourceRepository,
  >(kind: K, record: T): InventoryResource<T> {
    const source = {
      sourceInstance: this.sourceInstance,
      kind,
      id: record._id,
    };
    const owner = record.team_id;
    const validOwner =
      typeof owner === 'string' &&
      owner.trim().length > 0 &&
      (kind === 'repository' || isObjectId(owner));
    let ownership: InventoryResource['ownership'] = 'unresolved-owner';

    if (validOwner) {
      ownership = isObjectId(owner!) ? 'resolved-id' : 'unresolved-opaque';
    }

    return {
      source,
      record,
      vendor: classifyVendor(record, this.vendorPolicy),
      ownership,
      binding: {
        source,
        providerId: `pyxis-provider:${this.sourceInstance}`,
        projectionVersion: '1',
        status: validOwner ? 'projected' : 'unresolved-owner',
        ...(validOwner ? { entityRef: sourceRef(source) } : {}),
      },
    };
  }
}
