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
  SourceListing,
  SourceRepository,
  SourceTeam,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import { planMutation } from './reconciliation';
import { parseProjection, projectEntity } from './projection';
import { scanFixture, settings, fixtureClient, baseline } from './testSupport';
import { PyxisRelationshipProcessor } from './processor';

async function projections() {
  return planMutation(
    'internal',
    [],
    await scanFixture(),
    settings.providers.internal,
  ).projections;
}

describe('entity-validity processed-projection-safety projection validation and minimal fields', () => {
  it('projects missing display fields and optional member fields without inventing profiles', async () => {
    const items = await projections();

    for (const item of items) {
      if (item.source.kind === 'listing') {
        delete (item.record as SourceListing).name;
      }

      if (item.source.kind === 'repository') {
        delete (item.record as SourceRepository).display_data;
        delete (item.record as SourceRepository).repository;
      }

      if (item.source.kind === 'team') {
        delete (item.record as SourceTeam).name;
        delete item.roster!.sourceUpdatedAt;
        item.roster!.members = item.roster!.members.map(member => ({
          user: member.user,
        }));
      }
      expect(projectEntity(item).metadata.title).toBeUndefined();
    }

    const repository = items.find(item => item.source.kind === 'repository')!;
    (repository.record as SourceRepository).repository = 'path-only';
    expect(projectEntity(repository).metadata.title).toBe('path-only');

    for (const vendor of [null, 42, undefined]) {
      (repository.record as SourceRepository).vendor_label = vendor;
      const entity = projectEntity(repository);
      expect(JSON.stringify(entity)).not.toContain('42');
    }

    delete (repository.record as SourceRepository).vendor_label;
    expect(projectEntity(repository).kind).toBe('Resource');
  });

  it('rejects missing DTO requirements and invalid source scopes', async () => {
    const items = await projections();
    const group = items.find(item => item.source.kind === 'team')!;
    const user = items.find(item => item.source.kind === 'user')!;
    const listing = items.find(item => item.source.kind === 'listing')!;

    expect(() => parseProjection({ ...group, roster: undefined })).toThrow(
      'incomplete',
    );
    expect(() => parseProjection({ ...user, memberships: undefined })).toThrow(
      'incomplete',
    );
    expect(() => parseProjection({ ...listing, vendor: undefined })).toThrow(
      'incomplete',
    );
    expect(() => parseProjection({ ...listing, ownership: undefined })).toThrow(
      'incomplete',
    );

    for (const team of [
      { ...group.roster!.team, sourceInstance: 'other' },
      { ...group.roster!.team, id: baseline.teams[1]._id },
    ]) {
      expect(() =>
        parseProjection({ ...group, roster: { ...group.roster!, team } }),
      ).toThrow('roster-scope');
    }

    expect(() =>
      parseProjection({
        ...group,
        roster: {
          ...group.roster!,
          members: [{ user: { ...user.source, sourceInstance: 'other' } }],
        },
      }),
    ).toThrow('roster-scope');
    expect(() =>
      parseProjection({
        ...user,
        memberships: [{ team: { ...group.source, sourceInstance: 'other' } }],
      }),
    ).toThrow('membership-scope');
    expect(() =>
      parseProjection({
        ...listing,
        associations: { ...listing.associations!, subject: group.source },
      }),
    ).toThrow('association-scope');

    for (const change of [
      {
        target: {
          ...listing.associations!.associations[0].target,
          sourceInstance: 'other',
        },
      },
      { entityRef: 'resource:default/forged' },
    ]) {
      expect(() =>
        parseProjection({
          ...listing,
          associations: {
            ...listing.associations!,
            associations: [
              { ...listing.associations!.associations[0], ...change },
            ],
          },
        }),
      ).toThrow('association-scope');
    }

    expect(() =>
      projectEntity({
        ...listing,
        record: { ...(listing.record as SourceListing), team_id: null },
      }),
    ).toThrow('unresolved-owner');
    expect(() =>
      projectEntity({ ...listing, ownership: 'unresolved-owner' }),
    ).toThrow('unresolved-owner');
  });

  it('emits no fabricated relations from unresolved associations', async () => {
    const listing = (await projections()).find(
      item => item.source.kind === 'listing',
    )!;
    listing.associations!.associations = listing.associations!.associations.map(
      a => ({ ...a, status: 'not-found', entityRef: undefined }),
    );
    const emit = jest.fn();
    const processor = new PyxisRelationshipProcessor();
    await processor.postProcessEntity(projectEntity(listing), {}, emit);
    expect(emit).not.toHaveBeenCalled();
    delete listing.associations;
    await processor.postProcessEntity(projectEntity(listing), {}, emit);
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('reconciliation-guards membership-removal retention edge cases', () => {
  it('retains unknown associations and handles new tombstones and optional roles', async () => {
    const prior = await projections();
    const client = fixtureClient();

    jest.mocked(client.listListings).mockResolvedValue({
      data: baseline.listings.map(record => ({
        ...record,
        repositories: undefined,
      })),
      page: 0,
      pageSize: 100,
      total: 2,
    });
    jest.mocked(client.getTeam).mockImplementation(async id => ({
      state: 'found',
      data: { _id: id, members: [{ user_id: 'minimal' }] },
    }));

    const scan = await scanFixture(client);
    const plan = planMutation(
      'internal',
      prior,
      scan,
      settings.providers.internal,
    );

    expect(plan.projections.filter(p => p.source.kind === 'listing')).toEqual(
      prior.filter(p => p.source.kind === 'listing'),
    );
    expect(
      plan.projections.find(p => p.source.id === 'minimal')?.memberships,
    ).toHaveLength(2);

    const fresh = planMutation(
      'internal',
      [],
      scan,
      settings.providers.internal,
    );

    expect(
      fresh.projections.filter(p => p.source.kind === 'listing'),
    ).toHaveLength(2);

    const data = structuredClone(baseline);
    data.listings[0].deleted = true;
    const deleted = await scanFixture(fixtureClient(data));
    if (deleted.state !== 'complete') {
      throw new Error('scan failed');
    }

    deleted.data.notFound.push({
      sourceInstance: 'internal',
      kind: 'user',
      id: 'ignored',
    });

    expect(
      planMutation('internal', [], deleted, {
        absenceDeletion: 'confirmed-internal-404',
        internalNotFoundValidated: true,
      }).projections.some(p => p.source.id === data.listings[0]._id),
    ).toBe(false);
    expect(
      planMutation(
        'internal',
        prior,
        { ...deleted, traversal: { ...deleted.traversal, complete: false } },
        settings.providers.internal,
      ).mutation,
    ).toBeUndefined();
    deleted.data.quality.fetch = 'incomplete';
    expect(
      planMutation('internal', prior, deleted, settings.providers.internal)
        .mutation,
    ).toBeUndefined();
  });
});

it.each(['redhat-only', 'redhat-or-unlabeled'] as const)(
  'entity-validity configurable-vendor-admission-policy requires a configured policy and round-trips %s evidence',
  async policy => {
    const item = (await projections()).find(p => p.vendor)!;
    item.vendor = { ...item.vendor!, policy };
    expect(parseProjection(item).vendor).toEqual(item.vendor);
    const { policy: _policy, ...evidence } = item.vendor;
    expect(() => parseProjection({ ...item, vendor: evidence })).toThrow();

    for (const invalidPolicy of [undefined, null, 'all', 1]) {
      expect(() =>
        parseProjection({
          ...item,
          vendor: { ...item.vendor, policy: invalidPolicy },
        }),
      ).toThrow();
    }
  },
);
