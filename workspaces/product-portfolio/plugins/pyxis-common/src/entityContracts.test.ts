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

import type { Entity } from '@backstage/catalog-model';
import {
  isPyxisListing,
  isPyxisRepository,
  isPyxisTeam,
  isPyxisUser,
  PYXIS_ANNOTATIONS,
  PYXIS_ENTITY_TYPES,
} from './entityContracts';
import {
  parsePyxisProjection,
  parseRepositoryChiProjection,
  PyxisContractError,
} from './projectionParsers';

const id = '000000000000000000000001';
const at = '2026-10-13T12:00:00.000Z';
function fixture(kind: 'listing' | 'repository' | 'team' | 'user'): Entity {
  const source = { sourceInstance: 'production', kind, id };
  const projection = {
    version: '1',
    source,
    observation: {
      contractVersion: '1',
      startedAt: at,
      observedAt: at,
      traversal: { complete: true, atomic: false, pages: 1, records: 1 },
    },
    ...(kind === 'user' ? { memberships: [] } : { record: { _id: id } }),
    ...(['listing', 'repository'].includes(kind)
      ? {
          vendor: {
            wirePresence: 'missing',
            classification: 'missing',
            decision: 'unresolved',
            policy: 'redhat-only',
          },
          ownership: 'unresolved-owner',
        }
      : {}),
    ...(kind === 'team'
      ? {
          roster: {
            team: source,
            members: [],
            observedAt: at,
            completeness: 'complete',
            organizationalCurrency: 'unverified',
          },
        }
      : {}),
  };
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: {
      listing: 'Resource',
      repository: 'Resource',
      team: 'Group',
      user: 'User',
    }[kind],
    metadata: {
      name: kind,
      namespace: 'pyxis',
      annotations: {
        [PYXIS_ANNOTATIONS.sourceInstance]: 'production',
        [PYXIS_ANNOTATIONS.sourceKind]: kind,
        [PYXIS_ANNOTATIONS.sourceId]: id,
        [PYXIS_ANNOTATIONS.projectionVersion]: '1',
      },
    },
    spec: {
      ...(kind !== 'user' ? { type: PYXIS_ENTITY_TYPES[kind] } : {}),
      pyxis: projection,
    },
  };
}

describe('browser-safe projection contracts', () => {
  const guards = {
    listing: isPyxisListing,
    repository: isPyxisRepository,
    team: isPyxisTeam,
    user: isPyxisUser,
  };
  it.each(['listing', 'repository', 'team', 'user'] as const)(
    'validates %s and rejects cross-kind entities',
    kind => {
      const e = fixture(kind);
      expect(parsePyxisProjection(e.spec?.pyxis).source.kind).toBe(kind);
      for (const [name, guard] of Object.entries(guards))
        expect(guard(e)).toBe(name === kind);
      for (const mutation of [
        { ...e, kind: 'Component' },
        { ...e, metadata: { ...e.metadata, namespace: 'default' } },
        {
          ...e,
          metadata: {
            ...e.metadata,
            annotations: {
              ...e.metadata.annotations,
              [PYXIS_ANNOTATIONS.sourceId]: 'different',
            },
          },
        },
        { ...e, spec: { ...e.spec, pyxis: { version: '2' } } },
      ])
        expect(guards[kind](mutation)).toBe(false);
      expect(guards[kind]({ ...e, spec: { ...e.spec, type: 'other' } })).toBe(
        kind === 'user',
      );
    },
  );
  it.each([
    undefined,
    null,
    {},
    { version: '2' },
    { version: '1', source: { kind: 'repository' } },
  ])('rejects unsupported and malformed DTOs safely', value => {
    expect(() => parsePyxisProjection(value)).toThrow(PyxisContractError);
  });
  it('rejects malformed records and cross-source roster metadata', () => {
    const p = parsePyxisProjection(fixture('team').spec?.pyxis);
    expect(() =>
      parsePyxisProjection({ ...p, record: { _id: 'bad' } }),
    ).toThrow(PyxisContractError);
    expect(() =>
      parsePyxisProjection({
        ...p,
        roster: { ...p.roster, team: { ...p.source, sourceInstance: 'other' } },
      }),
    ).toThrow(PyxisContractError);
  });
  it.each(['hidden', 'unavailable', 'disabled'] as const)(
    'validates snapshot-free %s health',
    state => {
      expect(
        parseRepositoryChiProjection({
          schemaVersion: '2',
          enabled: state !== 'disabled',
          staleAfterSeconds: 60,
          state,
          lastAttempt: null,
          suppression: null,
          snapshot: null,
        }).state,
      ).toBe(state);
    },
  );
  it('rejects missing snapshots, invalid states and future CHI versions', () => {
    for (const value of [
      undefined,
      { schemaVersion: '3' },
      {
        schemaVersion: '2',
        enabled: true,
        staleAfterSeconds: 60,
        state: 'ready',
        lastAttempt: null,
        suppression: null,
        snapshot: null,
      },
    ])
      expect(() => parseRepositoryChiProjection(value)).toThrow(
        PyxisContractError,
      );
  });
  it('validates associations and rejects cross-source and cross-subject evidence', () => {
    const listing = parsePyxisProjection(fixture('listing').spec?.pyxis);
    const associations = {
      subject: listing.source,
      authority: 'pyxis:listing.repositories',
      complete: true,
      associations: [
        {
          target: { ...listing.source, kind: 'repository' },
          provenance: 'direct-listing',
          status: 'projected',
        },
      ],
      diagnostics: [],
    };
    expect(
      parsePyxisProjection({ ...listing, associations }).associations
        ?.associations,
    ).toHaveLength(1);
    for (const subject of [
      { ...listing.source, id: '000000000000000000000002' },
      { ...listing.source, kind: 'repository' },
      { ...listing.source, sourceInstance: 'other' },
    ])
      expect(() =>
        parsePyxisProjection({
          ...listing,
          associations: { ...associations, subject },
        }),
      ).toThrow(PyxisContractError);
    expect(() =>
      parsePyxisProjection({
        ...listing,
        associations: {
          ...associations,
          associations: [
            {
              ...associations.associations[0],
              target: {
                ...associations.associations[0].target,
                sourceInstance: 'other',
              },
            },
          ],
        },
      }),
    ).toThrow(PyxisContractError);
  });
  it('rejects cross-source membership and missing required category evidence', () => {
    const user = parsePyxisProjection(fixture('user').spec?.pyxis);
    const membership = {
      team: { ...user.source, kind: 'team' },
      role: 'owner',
      addedDate: at,
    };
    expect(
      parsePyxisProjection({ ...user, memberships: [membership] }).memberships,
    ).toHaveLength(1);
    expect(() =>
      parsePyxisProjection({
        ...user,
        memberships: [
          {
            ...membership,
            team: { ...membership.team, sourceInstance: 'other' },
          },
        ],
      }),
    ).toThrow(PyxisContractError);
    expect(() =>
      parsePyxisProjection({ ...user, record: { _id: id } }),
    ).toThrow(PyxisContractError);
    expect(() =>
      parsePyxisProjection({ ...user, memberships: undefined }),
    ).toThrow(PyxisContractError);
    const team = parsePyxisProjection(fixture('team').spec?.pyxis);
    const member = { user: user.source };
    expect(
      parsePyxisProjection({
        ...team,
        roster: { ...team.roster, members: [member] },
      }).roster?.members,
    ).toHaveLength(1);
    expect(() =>
      parsePyxisProjection({
        ...team,
        roster: {
          ...team.roster,
          members: [{ user: { ...user.source, sourceInstance: 'other' } }],
        },
      }),
    ).toThrow(PyxisContractError);
    expect(() => parsePyxisProjection({ ...team, roster: undefined })).toThrow(
      PyxisContractError,
    );
    const repository = parsePyxisProjection(fixture('repository').spec?.pyxis);
    expect(() =>
      parsePyxisProjection({ ...repository, vendor: undefined }),
    ).toThrow(PyxisContractError);
    expect(() =>
      parsePyxisProjection({ ...repository, ownership: undefined }),
    ).toThrow(PyxisContractError);
  });
});
