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
  groupEntityV1alpha1Validator,
  resourceEntityV1alpha1Validator,
  userEntityV1alpha1Validator,
  type Entity,
} from '@backstage/catalog-model';
import {
  sourceRef,
  PyxisInventoryReader,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-node';
import { fixtureClient, scanFixture, settings, baseline } from './testSupport';
import { ownedProjection, parseProjection, projectEntity } from './projection';
import { planMutation } from './reconciliation';
import { PyxisRelationshipProcessor } from './processor';

const config = settings.providers.internal;
async function initial() {
  const scan = await scanFixture();
  return planMutation('internal', [], scan, config);
}

describe('ownership ownership', () => {
  it('uses one source owner and preserves opaque IDs without fabricated Groups', async () => {
    const data = structuredClone(baseline);
    data.repositories[0].team_id = 'OPAQUE Team';
    const client = fixtureClient(data);
    const scan = await scanFixture(client);
    const plan = planMutation('internal', [], scan, config);
    const repository = plan.projections.find(
      p => p.source.id === data.repositories[0]._id,
    )!;

    expect(projectEntity(repository).spec?.owner).toBe(
      sourceRef({
        sourceInstance: 'internal',
        kind: 'team',
        id: 'OPAQUE Team',
      }),
    );
    expect(repository.ownership).toBe('unresolved-opaque');
    expect(client.getTeam).not.toHaveBeenCalledWith(
      'OPAQUE Team',
      expect.anything(),
    );
    expect(plan.projections.filter(p => p.source.kind === 'team')).toHaveLength(
      2,
    );
  });

  it('blocks new Resources with missing or malformed owner fields', async () => {
    const data = structuredClone(baseline);
    data.repositories[0].team_id = '';
    data.listings[0].team_id = 'opaque';
    const plan = planMutation(
      'internal',
      [],
      await scanFixture(fixtureClient(data)),
      config,
    );

    expect(
      plan.projections.some(p => p.source.id === data.repositories[0]._id),
    ).toBe(false);
    expect(
      plan.projections.some(p => p.source.id === data.listings[0]._id),
    ).toBe(false);
  });
});

describe('associations direct associations', () => {
  it('enumerates independently, resolves direct missing targets and records inverse discrepancies', async () => {
    const client = fixtureClient();
    jest
      .mocked(client.listRepositories)
      .mockResolvedValue({ page: 0, pageSize: 100, total: 0, data: [] });
    const scan = await scanFixture(client);

    expect(client.getRepository).toHaveBeenCalledTimes(2);
    expect(scan.state).toBe('complete');

    if (scan.state !== 'complete') {
      return;
    }

    expect(
      scan.data.listings.flatMap(item => item.associations!.associations),
    ).toHaveLength(3);

    const data = structuredClone(baseline);
    data.repositories[0].product_listings = [];
    data.repositories[1].vendor_label = 'other';
    const altered = await scanFixture(fixtureClient(data));

    if (altered.state !== 'complete') {
      throw new Error('scan failed');
    }

    expect(altered.data.listings[0].associations).toMatchObject({
      diagnostics: [{ code: 'inverse-association-discrepancy', count: 1 }],
    });
    expect(altered.data.listings[0].associations!.associations[1].status).toBe(
      'excluded-vendor',
    );
  });

  it('retains not-found, unprojectable and ambiguous association evidence', async () => {
    const client = fixtureClient();
    jest.mocked(client.listRepositories).mockResolvedValue({
      page: 0,
      pageSize: 100,
      total: 1,
      data: [{ ...baseline.repositories[0], team_id: '' }],
    });
    jest.mocked(client.getRepository).mockResolvedValue({
      state: 'not-found',
      authority: 'internal-source-404',
    });

    const scan = await scanFixture(client);
    if (scan.state !== 'complete') {
      throw new Error('scan failed');
    }

    expect(
      scan.data.listings[0].associations!.associations.map(a => a.status),
    ).toEqual(['projection-unresolved', 'not-found']);
    jest.mocked(client.listRepositories).mockResolvedValue({
      page: 0,
      pageSize: 100,
      total: baseline.repositories.length,
      data: baseline.repositories.map(record => ({
        ...record,
        vendor_label: null,
      })),
    });

    const ambiguous = await scanFixture(client);
    if (ambiguous.state !== 'complete') {
      throw new Error('scan failed');
    }

    expect(
      ambiguous.data.listings[0].associations!.associations[0].status,
    ).toBe('admission-unresolved');
  });
});

describe('entity-validity entity validity', () => {
  it('projects exactly nine schema-valid source entities and three forward/inverse pairs', async () => {
    const plan = await initial();
    const entities = plan.projections.map(projectEntity);
    expect(entities).toHaveLength(9);
    const processor = new PyxisRelationshipProcessor();
    const emit = jest.fn();

    for (const entity of entities) {
      const validate = {
        Resource: resourceEntityV1alpha1Validator,
        Group: groupEntityV1alpha1Validator,
        User: userEntityV1alpha1Validator,
      }[entity.kind]!;
      expect(await validate.check(entity)).toBe(true);
      expect(entity.metadata.name).toHaveLength(54);
      expect(entity.metadata.namespace).toBe('pyxis');
      expect(ownedProjection(entity, 'internal').version).toBe('1');
      await processor.postProcessEntity(entity, {}, emit);
    }

    expect(
      emit.mock.calls.filter(([r]) => r.relation.type === 'pyxisHasRepository'),
    ).toHaveLength(3);
    expect(
      emit.mock.calls.filter(([r]) => r.relation.type === 'pyxisRepositoryOf'),
    ).toHaveLength(3);
    expect(
      JSON.stringify(
        entities.filter(
          entity => entity.kind === 'Group' || entity.kind === 'User',
        ),
      ),
    ).not.toMatch(/email/);
    expect(JSON.stringify(entities)).not.toMatch(/System|dependsOn/);
  });
});

describe('reconciliation-guards reconciliation guards', () => {
  it('prevents mutation on failed pages, lookups, cancellation and malformed traversal', async () => {
    const prior = (await initial()).projections;
    for (const method of [
      'listListings',
      'listRepositories',
      'getTeam',
    ] as const) {
      const client = fixtureClient();
      jest
        .mocked(client[method])
        .mockRejectedValue(new Error('synthetic failure'));
      const scan = await scanFixture(client);
      expect(
        planMutation('internal', prior, scan, config).mutation,
      ).toBeUndefined();
    }

    const cancelled = await new PyxisInventoryReader(
      'internal',
      fixtureClient(),
      settings.sources.internal,
    ).scan({ signal: AbortSignal.abort() });
    expect(cancelled.state).toBe('unavailable');
  });

  it('retains complete empty, vendor ambiguity, unresolved owners and unpublished repositories', async () => {
    const prior = (await initial()).projections;
    const empty = await scanFixture(
      fixtureClient({ listings: [], repositories: [], teams: [] }),
    );

    expect(
      planMutation('internal', prior, empty, config).projections,
    ).toHaveLength(9);

    const client = fixtureClient();
    jest.mocked(client.listRepositories).mockResolvedValue({
      page: 0,
      pageSize: 100,
      total: baseline.repositories.length,
      data: baseline.repositories.map(r => ({
        ...r,
        vendor_label: null,
        team_id: '',
      })),
    });

    const plan = planMutation(
      'internal',
      prior,
      await scanFixture(client),
      config,
    );
    expect(
      plan.projections.filter(p => p.source.kind === 'repository'),
    ).toEqual(prior.filter(p => p.source.kind === 'repository'));
    const repeated = planMutation(
      'internal',
      prior,
      await scanFixture(),
      config,
    );
    expect(repeated.projections.map(p => sourceRef(p.source))).toEqual(
      prior.map(p => sourceRef(p.source)),
    );
  });

  it('removes only explicit tombstones, vendor exclusions or opt-in confirmed internal absence', async () => {
    const prior = (await initial()).projections;
    const data = structuredClone(baseline);
    data.listings[0].deleted = true;
    data.repositories[0].vendor_label = 'other';
    const plan = planMutation(
      'internal',
      prior,
      await scanFixture(fixtureClient(data)),
      config,
    );

    expect(plan.mutation).toMatchObject({
      type: 'delta',
      removed: expect.any(Array),
    });

    if (plan.mutation?.type !== 'delta') {
      throw new Error('no delta');
    }
    expect(plan.mutation.removed).toHaveLength(2);

    const scan = await new PyxisInventoryReader(
      'internal',
      fixtureClient({ listings: [], repositories: [], teams: [] }),
      settings.sources.internal,
      prior.map(p => p.source),
    ).scan({});

    expect(
      planMutation('internal', prior, scan, config).projections,
    ).toHaveLength(9);
    expect(
      planMutation('internal', prior, scan, {
        absenceDeletion: 'confirmed-internal-404',
        internalNotFoundValidated: true,
      }).projections,
    ).toHaveLength(0);
  });
});

describe('reconciliation-delta incremental catalog mutations', () => {
  it('retains prior projections when only scan observation metadata changes', async () => {
    const scan = await scanFixture();
    if (scan.state !== 'complete') {
      throw new Error('scan failed');
    }

    const prior = planMutation('internal', [], scan, config).projections.map(
      projection => ownedProjection(projectEntity(projection), 'internal'),
    );
    const later = (value: string) =>
      new Date(Date.parse(value) + 1000).toISOString();
    const nextScan = {
      ...scan,
      startedAt: later(scan.startedAt),
      observedAt: later(scan.observedAt),
      data: {
        ...scan.data,
        teams: scan.data.teams.map(team => ({
          ...team,
          roster: {
            ...team.roster,
            observedAt: later(team.roster.observedAt),
          },
        })),
      },
    };

    const repeated = planMutation('internal', prior, nextScan, config);

    expect(repeated.mutation).toEqual({
      type: 'delta',
      added: [],
      removed: [],
    });
    expect(repeated.retained).toBe(prior.length);
    expect(repeated.projections).toEqual(prior);
  });

  it('adds only projections whose provider-owned content changed', async () => {
    const prior = (await initial()).projections.map(projection =>
      ownedProjection(projectEntity(projection), 'internal'),
    );
    const data = structuredClone(baseline);
    data.listings[0].name = 'Updated listing title';
    const plan = planMutation(
      'internal',
      prior,
      await scanFixture(fixtureClient(data)),
      config,
    );

    if (plan.mutation?.type !== 'delta') {
      throw new Error('no delta');
    }

    expect(
      plan.mutation.added.map(({ entity }) =>
        sourceRef(ownedProjection(entity, 'internal').source),
      ),
    ).toEqual([
      sourceRef({
        sourceInstance: 'internal',
        kind: 'listing',
        id: data.listings[0]._id,
      }),
    ]);
    expect(plan.mutation.removed).toEqual([]);
    expect(plan.retained).toBe(prior.length - 1);
  });
});

describe('membership-removal membership removal', () => {
  it('removes complete contributions, preserves shared members and retains incomplete contributions', async () => {
    const prior = (await initial()).projections;
    const data = structuredClone(baseline);
    data.teams[0].members = [];
    const plan = planMutation(
      'internal',
      prior,
      await scanFixture(fixtureClient(data)),
      config,
    );

    expect(
      plan.projections
        .filter(p => p.source.kind === 'user')
        .map(p => p.source.id),
    ).toEqual(['person-B']);
    expect(
      plan.projections.find(p => p.source.id === 'person-B')!.memberships,
    ).toHaveLength(1);

    const client = fixtureClient(data);
    jest.mocked(client.getTeam).mockImplementation(async id => ({
      state: 'found',
      data: { ...data.teams.find(t => t._id === id)!, members: undefined },
    }));

    const retained = planMutation(
      'internal',
      prior,
      await scanFixture(client),
      config,
    );
    expect(
      retained.projections.filter(p => p.source.kind === 'user'),
    ).toHaveLength(2);
    expect(
      retained.projections.find(p => p.source.id === 'person-B')!.memberships,
    ).toHaveLength(2);
  });
});

describe('processed-projection-safety processed projection safety', () => {
  it('reconstructs without stitched state and rejects namespace or source-key conflicts', async () => {
    const p = (await initial()).projections[0];
    const entity: Entity & { status: { items: unknown[] } } = {
      ...projectEntity(p),
      status: { items: [] },
      relations: [{ type: 'foreign', targetRef: 'user:default/admin' }],
    };
    entity.metadata.uid = 'processed-uid';
    const restored = projectEntity(ownedProjection(entity, 'internal'));

    expect(restored).not.toHaveProperty('status');
    expect(restored).not.toHaveProperty('relations');
    expect(restored.metadata.uid).toBeUndefined();
    expect(() =>
      ownedProjection(
        { ...entity, metadata: { ...entity.metadata, namespace: 'default' } },
        'internal',
      ),
    ).toThrow('conflict');
    expect(() => ownedProjection(entity, 'other')).toThrow('conflict');
    expect(() => parseProjection({ ...p, version: '2' })).toThrow(
      'invalid-projection',
    );
    expect(() => parseProjection({ ...p, record: { _id: 'bad' } })).toThrow(
      'record',
    );
    expect(() =>
      parseProjection({ ...p, source: { ...p.source, id: 'different' } }),
    ).toThrow('record');
  });
});

describe('reconciliation-guards configurable-vendor-admission-policy vendor policy transitions', () => {
  it('admits unlabeled records in broad mode, retains them in strict mode and removes confirmed other vendors', async () => {
    const client = fixtureClient();
    const listings = baseline.listings.map(
      ({ vendor_label: _vendor, ...record }) => record,
    );
    const repositories = baseline.repositories.map(record => ({
      ...record,
      vendor_label: null,
    }));

    jest.mocked(client.listListings).mockResolvedValue({
      page: 0,
      pageSize: 100,
      total: listings.length,
      data: listings,
    });
    jest.mocked(client.listRepositories).mockResolvedValue({
      page: 0,
      pageSize: 100,
      total: repositories.length,
      data: repositories,
    });

    const strictScan = await scanFixture(client);
    const strict = planMutation('internal', [], strictScan, config);

    expect(
      strict.projections.filter(
        p => p.source.kind === 'listing' || p.source.kind === 'repository',
      ),
    ).toEqual([]);

    const broadConfig = {
      ...config,
      vendorPolicy: 'redhat-or-unlabeled' as const,
    };
    const broad = planMutation(
      'internal',
      strict.projections,
      await scanFixture(client, broadConfig.vendorPolicy),
      broadConfig,
    );

    expect(broad.projections).toHaveLength(9);
    expect(
      broad.projections.filter(p => p.vendor).map(p => p.vendor?.policy),
    ).toEqual(Array(5).fill('redhat-or-unlabeled'));

    const retained = planMutation(
      'internal',
      broad.projections,
      strictScan,
      config,
    );
    expect(
      retained.projections.map(
        ({ observation: _observation, ...projection }) => projection,
      ),
    ).toEqual(
      broad.projections.map(
        ({ observation: _observation, ...projection }) => projection,
      ),
    );
    expect(retained.projections.filter(p => p.vendor)).toEqual(
      broad.projections.filter(p => p.vendor),
    );
    expect(retained.mutation).toMatchObject({ type: 'delta', removed: [] });

    const repeated = planMutation(
      'internal',
      retained.projections,
      strictScan,
      config,
    );
    expect(repeated.projections).toEqual(retained.projections);
    jest.mocked(client.listListings).mockResolvedValue({
      page: 0,
      pageSize: 100,
      total: listings.length,
      data: listings.map(record => ({ ...record, vendor_label: 'other' })),
    });
    jest.mocked(client.listRepositories).mockResolvedValue({
      page: 0,
      pageSize: 100,
      total: repositories.length,
      data: repositories.map(record => ({
        ...record,
        vendor_label: 'other',
      })),
    });

    for (const vendorPolicy of [
      'redhat-only',
      'redhat-or-unlabeled',
    ] as const) {
      const excluded = planMutation(
        'internal',
        broad.projections,
        await scanFixture(client, vendorPolicy),
        config,
      );

      expect(
        excluded.projections.filter(
          p => p.source.kind === 'listing' || p.source.kind === 'repository',
        ),
      ).toEqual([]);
      expect(excluded.mutation).toMatchObject({
        type: 'delta',
        removed: expect.arrayContaining(
          broad.projections
            .filter(p => p.vendor)
            .map(p => ({
              entityRef: sourceRef(p.source),
              locationKey: 'pyxis-provider:internal',
            })),
        ),
      });
    }
  });
});
