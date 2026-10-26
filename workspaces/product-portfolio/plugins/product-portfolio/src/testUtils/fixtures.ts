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

import { stringifyEntityRef, type Entity } from '@backstage/catalog-model';
import {
  PYXIS_ANNOTATIONS,
  PYXIS_ENTITY_TYPES,
  PYXIS_RELATIONS,
  type PyxisKind,
  type PyxisProjection,
  type RepositoryChiProjection,
  type ChiGrade,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-common';

export const observedAt = '2026-10-14T10:00:00.000Z';
export function fixtureEntity(kind: PyxisKind, index = 1): Entity {
  const id = index.toString(16).padStart(24, '0');
  const source = { sourceInstance: 'fixture', kind, id };
  const projection: PyxisProjection = {
    version: '1',
    source,
    observation: {
      contractVersion: '1',
      startedAt: observedAt,
      observedAt,
      traversal: { complete: true, atomic: false, pages: 1, records: 1 },
    },
    ...(kind === 'user'
      ? { memberships: [] }
      : {
          record: {
            _id: id,
            name: `${kind} ${index}`,
            last_update_date: observedAt,
          },
        }),
    ...(['listing', 'repository'].includes(kind)
      ? {
          vendor: {
            wirePresence: 'present' as const,
            wireValue: 'redhat',
            classification: 'redhat' as const,
            decision: 'admit' as const,
            policy: 'redhat-only' as const,
          },
          ownership: 'resolved-id' as const,
        }
      : {}),
    ...(kind === 'team'
      ? {
          roster: {
            team: { ...source, kind: 'team' as const },
            members: [],
            observedAt,
            completeness: 'complete' as const,
            organizationalCurrency: 'unverified' as const,
          },
        }
      : {}),
  };
  if (kind === 'repository')
    projection.record = {
      _id: id,
      registry: 'registry.redhat.io',
      repository: `portfolio/repository-${index}`,
      display_data: {
        name: `Repository ${index}`,
        long_description: `Long description for repository ${index}`,
        short_description: `Short description for repository ${index}`,
      },
      published: true,
      last_update_date: observedAt,
    };
  if (kind === 'listing')
    projection.record = {
      _id: id,
      name: `Listing ${index}`,
      descriptions: {
        long: `Long description for listing ${index}`,
        short: `Short description for listing ${index}`,
      },
      published: index !== 2,
      deleted: index === 2,
      last_update_date: observedAt,
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
      name: `${kind}-${index}`,
      title: `${kind[0].toLocaleUpperCase('en-US')}${kind.slice(1)} ${index}`,
      namespace: 'pyxis',
      annotations: {
        [PYXIS_ANNOTATIONS.sourceInstance]: 'fixture',
        [PYXIS_ANNOTATIONS.sourceKind]: kind,
        [PYXIS_ANNOTATIONS.sourceId]: id,
        [PYXIS_ANNOTATIONS.providerId]: 'pyxis-provider:fixture',
        [PYXIS_ANNOTATIONS.projectionVersion]: '1',
      },
    },
    spec: {
      ...(kind === 'user' ? {} : { type: PYXIS_ENTITY_TYPES[kind] }),
      pyxis: JSON.parse(JSON.stringify(projection)),
    },
    relations: [],
  };
}
export function fixtureHealth(
  entity: Entity,
  state: RepositoryChiProjection['state'] = 'ready',
  grade: ChiGrade | null = 'A',
): RepositoryChiProjection {
  const snapshot: NonNullable<RepositoryChiProjection['snapshot']> = {
    schemaVersion: '2',
    normalizationVersion: 'pyxis-chi-v2',
    population: 'latest-published-per-stream-architecture',
    source: {
      sourceInstance: 'fixture',
      kind: 'repository',
      id: entity.metadata.annotations![PYXIS_ANNOTATIONS.sourceId],
    },
    locator: {
      registry: 'registry.redhat.io',
      repository: `portfolio/${entity.metadata.name}`,
    },
    streamPolicy: {
      tags: ['latest', '9.4'],
      origin: 'configured',
      includesMultipleContentStreams: true,
    },
    startedAt: observedAt,
    selectionAt: observedAt,
    observedAt,
    contextCheckedAt: observedAt,
    sourceUpdatedAt: null,
    sourceCalculationFreshness: 'unknown',
    hiddenUntil: null,
    published: true,
    coverage: {
      fetch: 'complete',
      atomic: false,
      allRepositoryImages: false,
      selection: state === 'partial' ? 'partial' : 'complete',
      architectureExpectations: state === 'partial' ? 'unverified' : 'verified',
      grades: 'complete',
      candidatePages: 1,
      candidateRecords: 1,
    },
    issues: state === 'partial' ? ['missing-expected-architecture'] : [],
    contentHash: 'a'.repeat(64),
    streams: [],
    images: [],
    counts: {
      total: state === 'empty' ? 0 : 1,
      byGrade: { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, unknown: 0 },
      aWithScheduledDrop: 0,
      byAttention: {
        ok: state === 'empty' ? 0 : 1,
        warning: 0,
        problem: 0,
        unknown: 0,
      },
    },
  };
  if (state !== 'empty') {
    snapshot.counts.byGrade[grade ?? 'unknown'] = 1;
    snapshot.images = [
      {
        imageId: 'image-1',
        architecture: 'amd64',
        selectedIn: ['latest', '9.4'],
        pushDates: { latest: observedAt, '9.4': observedAt },
        activeTags: ['latest', '9.4'],
        manifestDigest: null,
        manifestListDigest: null,
        publishedAt: null,
        currentGrade: grade,
        gradeOrigin: 'normalized-source-periods',
        gradeQuality: grade ? 'known' : 'unknown',
        periodEvidence: grade ? 'valid' : 'absent',
        periods: grade
          ? [{ grade, startAt: observedAt, endAt: null, createdAt: observedAt }]
          : [],
        futureDrops: [],
        attention: 'ok',
      },
    ];
  }
  snapshot.streams = ['latest', '9.4'].map(tag => ({
    tag,
    architectures: {
      basis: 'configured',
      expected: ['amd64', 'arm64'],
      observed: ['amd64'],
      missing: state === 'partial' ? ['arm64'] : [],
    },
    slots: [
      {
        architecture: 'amd64',
        state: 'selected',
        imageId: 'image-1',
        pushDate: observedAt,
        reason: null,
      },
      ...(state === 'partial'
        ? [
            {
              architecture: 'arm64',
              state: 'missing' as const,
              imageId: null,
              pushDate: null,
              reason: 'missing-expected-architecture' as const,
            },
          ]
        : []),
    ],
    issues: snapshot.issues,
    counts: snapshot.counts,
    worstKnownGrade: grade,
    earliestDrop: null,
  }));
  return {
    schemaVersion: '2',
    enabled: state !== 'disabled',
    staleAfterSeconds: 86400,
    state,
    lastAttempt: { at: observedAt, outcome: 'complete' },
    suppression:
      state === 'hidden'
        ? { hiddenUntil: '2099-01-01T00:00:00.000Z', observedAt }
        : null,
    snapshot: ['ready', 'partial', 'empty'].includes(state) ? snapshot : null,
  };
}
function relation(from: Entity, type: string, to: Entity) {
  from.relations!.push({ type, targetRef: stringifyEntityRef(to) });
}
export function portfolioFixtures(count = 32): Entity[] {
  const listings = [fixtureEntity('listing', 1), fixtureEntity('listing', 2)];
  const teams = [fixtureEntity('team', 1), fixtureEntity('team', 2)];
  const users = [
    fixtureEntity('user', 1),
    fixtureEntity('user', 2),
    fixtureEntity('user', 3),
  ];
  const repositories = Array.from({ length: Math.max(6, count - 7) }, (_, i) =>
    fixtureEntity('repository', i + 1),
  );
  repositories.forEach((r, i) => {
    const state = (
      [
        'ready',
        'partial',
        'empty',
        'hidden',
        'unavailable',
        'disabled',
      ] as const
    )[i % 6];
    const health = fixtureHealth(r, state);
    if (i === 1 && health.snapshot) {
      health.snapshot.images[0].futureDrops = [
        { from: 'A', to: 'B', at: '2099-01-01T00:00:00.000Z' },
      ];
      health.snapshot.counts.aWithScheduledDrop = 1;
    }
    r.spec!.pyxisChi = JSON.parse(JSON.stringify(health));
    relation(r, PYXIS_RELATIONS.repositoryOf, listings[i % 2]);
    relation(listings[i % 2], PYXIS_RELATIONS.hasRepository, r);
    relation(r, 'ownedBy', teams[i % 2]);
    relation(teams[i % 2], 'ownerOf', r);
  });
  listings.forEach((l, i) => {
    relation(l, 'ownedBy', teams[i]);
    relation(teams[i], 'ownerOf', l);
  });
  teams.forEach((team, i) => {
    const p = team.spec!.pyxis as unknown as PyxisProjection;
    p.roster!.completeness = i ? 'partial' : 'complete';
    for (const user of users.slice(i, 2)) {
      relation(team, 'hasMember', user);
      relation(user, 'memberOf', team);
      const u = user.spec!.pyxis as unknown as PyxisProjection;
      p.roster!.members = [
        ...p.roster!.members,
        {
          user: { ...u.source, kind: 'user' },
          role: 'maintainer',
          addedDate: observedAt,
        },
      ];
      u.memberships = [
        ...(u.memberships ?? []),
        {
          team: { ...p.source, kind: 'team' },
          role: 'maintainer',
          addedDate: observedAt,
        },
      ];
    }
  });
  return [
    ...listings,
    ...repositories,
    ...teams,
    ...users,
    {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: { name: 'unrelated', namespace: 'default' },
      spec: {
        type: 'service',
        lifecycle: 'production',
        owner: 'group:default/guests',
      },
    },
  ];
}

export function teamPortfolioFixtures(): Entity[] {
  const entities = portfolioFixtures(13);
  const team = entities.find(entity => entity.metadata.name === 'team-1')!;
  const listing = entities.find(
    entity => entity.metadata.name === 'listing-1',
  )!;
  const repository1 = entities.find(
    entity => entity.metadata.name === 'repository-1',
  )!;
  const repository3 = entities.find(
    entity => entity.metadata.name === 'repository-3',
  )!;
  const repository5 = entities.find(
    entity => entity.metadata.name === 'repository-5',
  )!;
  const teamRef = stringifyEntityRef(team);
  const listingRef = stringifyEntityRef(listing);
  const repository1Ref = stringifyEntityRef(repository1);
  const repository5Ref = stringifyEntityRef(repository5);

  team.relations = team.relations!.filter(
    edge => edge.type !== 'ownerOf' || edge.targetRef !== repository1Ref,
  );
  repository1.relations = repository1.relations!.filter(
    edge => edge.type !== 'ownedBy' || edge.targetRef !== teamRef,
  );
  listing.relations = listing.relations!.filter(
    edge =>
      edge.type !== PYXIS_RELATIONS.hasRepository ||
      edge.targetRef !== repository5Ref,
  );
  repository5.relations = repository5.relations!.filter(
    edge =>
      edge.type !== PYXIS_RELATIONS.repositoryOf ||
      edge.targetRef !== listingRef,
  );
  repository3.spec!.pyxisChi = JSON.parse(
    JSON.stringify(fixtureHealth(repository3, 'ready', 'A')),
  );
  repository5.spec!.pyxisChi = JSON.parse(
    JSON.stringify(fixtureHealth(repository5, 'ready', 'B')),
  );

  return entities;
}
