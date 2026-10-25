/*
 * Copyright Red Hat, Inc.
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

import type { RepositoryChiProjection } from './chi';
import { aggregateRepositoryChi, getRepositoryChiQuality } from './chiSummary';

const projection: RepositoryChiProjection = {
  schemaVersion: '2',
  enabled: true,
  staleAfterSeconds: 3600,
  state: 'ready',
  lastAttempt: { at: '2026-10-13T12:00:00.000Z', outcome: 'complete' },
  suppression: null,
  snapshot: {
    schemaVersion: '2',
    normalizationVersion: 'pyxis-chi-v2',
    population: 'latest-published-per-stream-architecture',
    source: {
      sourceInstance: 'production',
      kind: 'repository',
      id: '000000000000000000000001',
    },
    locator: {
      registry: 'registry.redhat.io',
      repository: 'example/component',
    },
    streamPolicy: {
      tags: ['9.4'],
      origin: 'configured',
      includesMultipleContentStreams: false,
    },
    startedAt: '2026-10-13T11:59:00.000Z',
    selectionAt: '2026-10-13T12:00:00.000Z',
    observedAt: '2026-10-13T12:00:01.000Z',
    contextCheckedAt: '2026-10-13T12:00:01.000Z',
    sourceUpdatedAt: null,
    sourceCalculationFreshness: 'unknown',
    hiddenUntil: null,
    published: true,
    coverage: {
      fetch: 'complete',
      atomic: false,
      allRepositoryImages: false,
      selection: 'complete',
      architectureExpectations: 'verified',
      grades: 'complete',
      candidatePages: 1,
      candidateRecords: 1,
    },
    issues: [],
    contentHash: '0'.repeat(64),
    streams: [],
    images: [],
    counts: {
      total: 1,
      byGrade: { A: 1, B: 0, C: 0, D: 0, E: 0, F: 0, unknown: 0 },
      aWithScheduledDrop: 0,
      byAttention: { ok: 1, warning: 0, problem: 0, unknown: 0 },
    },
  },
};

describe('chi listing aggregation and freshness', () => {
  it('evaluates staleness from selectionAt', () => {
    expect(
      getRepositoryChiQuality(
        projection,
        Date.parse('2026-10-13T13:00:00.000Z'),
      ).stale,
    ).toBe(true);
  });

  it('deduplicates identical direct repository contributions', () => {
    const result = aggregateRepositoryChi(
      [
        { repositoryRef: 'resource:pyxis/r-1', projection },
        { repositoryRef: 'resource:pyxis/r-1', projection },
      ],
      Date.parse('2026-10-13T12:30:00.000Z'),
    );
    expect(result.repositories.total).toBe(1);
    expect(result.counts.total).toBe(1);
    expect(result.complete).toBe(true);
  });

  it('treats an expected repository without CHI as unavailable', () => {
    const result = aggregateRepositoryChi(
      [{ repositoryRef: 'resource:pyxis/r-2', projection: null }],
      Date.parse('2026-10-13T12:30:00.000Z'),
    );
    expect(result.repositories).toMatchObject({ unavailable: 1, stale: 1 });
    expect(result.complete).toBe(false);
  });

  it('rejects conflicting duplicate repository inputs', () => {
    expect(() =>
      aggregateRepositoryChi(
        [
          { repositoryRef: 'resource:pyxis/r-1', projection },
          {
            repositoryRef: 'resource:pyxis/r-1',
            projection: { ...projection, state: 'partial' },
          },
        ],
        Date.now(),
      ),
    ).toThrow('pyxis-chi-conflicting-repository');
  });

  it('evaluates every availability and dynamic quality dimension', () => {
    const withPeriod: RepositoryChiProjection = JSON.parse(
      JSON.stringify(projection),
    );
    withPeriod.snapshot!.images = [
      {
        imageId: '300000000000000000000001',
        architecture: 'amd64',
        selectedIn: ['9.4'],
        pushDates: { '9.4': '2026-10-12T00:00:00.000Z' },
        activeTags: ['9.4'],
        manifestDigest: null,
        manifestListDigest: null,
        publishedAt: null,
        currentGrade: 'A',
        gradeOrigin: 'normalized-source-periods',
        gradeQuality: 'known',
        periodEvidence: 'valid',
        periods: [
          {
            grade: 'A',
            startAt: '2026-10-01T00:00:00.000Z',
            endAt: null,
            createdAt: null,
          },
          {
            grade: 'B',
            startAt: '2026-10-13T12:15:00.000Z',
            endAt: '2026-10-14T00:00:00.000Z',
            createdAt: null,
          },
        ],
        futureDrops: [],
        attention: 'ok',
      },
    ];
    withPeriod.suppression = {
      hiddenUntil: '2026-10-13T12:20:00.000Z',
      observedAt: '2026-10-13T12:00:01.000Z',
    };
    withPeriod.lastAttempt = {
      at: '2026-10-13T12:05:00.000Z',
      outcome: 'failed',
      code: 'transport',
    };
    withPeriod.snapshot!.coverage.selection = 'partial';
    withPeriod.snapshot!.coverage.architectureExpectations = 'unverified';
    expect(
      getRepositoryChiQuality(
        withPeriod,
        Date.parse('2026-10-13T12:30:00.000Z'),
      ),
    ).toMatchObject({
      transitionDue: true,
      refreshFailed: true,
      selectionIncomplete: true,
      architectureCoverageUnverified: true,
    });

    for (const [state, availability] of [
      ['ready', 'known'],
      ['partial', 'partial'],
      ['empty', 'empty'],
      ['hidden', 'hidden'],
      ['unavailable', 'unavailable'],
      ['disabled', 'disabled'],
    ] as const) {
      expect(
        getRepositoryChiQuality(
          {
            ...projection,
            state,
            snapshot: state === 'unavailable' ? null : projection.snapshot,
          },
          Date.parse('2026-10-13T12:30:00.000Z'),
        ).availability,
      ).toBe(availability);
    }
    expect(
      getRepositoryChiQuality(
        { ...projection, state: 'disabled', snapshot: null },
        Date.now(),
      ).stale,
    ).toBe(false);
  });

  it('aggregates overlap counters, stream gaps and oldest observations', () => {
    const incomplete: RepositoryChiProjection = JSON.parse(
      JSON.stringify(projection),
    );
    incomplete.state = 'partial';
    incomplete.lastAttempt = {
      at: '2026-10-13T12:10:00.000Z',
      outcome: 'failed',
      code: 'transport',
    };
    incomplete.snapshot!.observedAt = '2026-10-13T11:00:00.000Z';
    incomplete.snapshot!.coverage.architectureExpectations = 'unverified';
    incomplete.snapshot!.coverage.selection = 'partial';
    incomplete.snapshot!.images = [
      {
        imageId: '300000000000000000000010',
        architecture: 'amd64',
        selectedIn: ['9.4'],
        pushDates: { '9.4': '2026-10-12T00:00:00.000Z' },
        activeTags: ['9.4'],
        manifestDigest: null,
        manifestListDigest: null,
        publishedAt: null,
        currentGrade: 'A',
        gradeOrigin: 'normalized-source-periods',
        gradeQuality: 'known',
        periodEvidence: 'valid',
        periods: [
          {
            grade: 'A',
            startAt: '2026-10-01T00:00:00.000Z',
            endAt: '2026-10-13T12:15:00.000Z',
            createdAt: null,
          },
        ],
        futureDrops: [],
        attention: 'ok',
      },
    ];
    incomplete.snapshot!.streams = [
      {
        tag: '9.4',
        architectures: {
          basis: 'configured',
          expected: ['amd64', 's390x'],
          observed: ['amd64'],
          missing: ['s390x'],
        },
        slots: [
          {
            architecture: 'amd64',
            state: 'uncertain',
            imageId: null,
            pushDate: null,
            reason: 'tied-latest',
          },
          {
            architecture: 's390x',
            state: 'missing',
            imageId: null,
            pushDate: null,
            reason: 'missing-expected-architecture',
          },
        ],
        issues: [],
        counts: {
          total: 0,
          byGrade: {
            A: 0,
            B: 0,
            C: 0,
            D: 0,
            E: 0,
            F: 0,
            unknown: 0,
          },
          aWithScheduledDrop: 0,
          byAttention: { ok: 0, warning: 0, problem: 0, unknown: 0 },
        },
        worstKnownGrade: null,
        earliestDrop: null,
      },
    ];
    const result = aggregateRepositoryChi(
      [
        { repositoryRef: 'resource:pyxis/ready', projection },
        { repositoryRef: 'resource:pyxis/partial', projection: incomplete },
        {
          repositoryRef: 'resource:pyxis/no-snapshot',
          projection: {
            ...projection,
            state: 'unavailable',
            snapshot: null,
          },
        },
        {
          repositoryRef: 'resource:pyxis/newer',
          projection: {
            ...projection,
            snapshot: {
              ...projection.snapshot!,
              observedAt: '2026-10-13T12:30:00.000Z',
            },
          },
        },
      ],
      Date.parse('2026-10-13T13:30:00.000Z'),
    );
    expect(result).toMatchObject({
      complete: false,
      repositories: {
        ready: 2,
        partial: 1,
        unavailable: 1,
        stale: 4,
        refreshFailed: 1,
        transitionDue: 1,
        architectureCoverageUnverified: 2,
      },
      streams: { total: 1, incomplete: 1, missingArchitectureSlots: 1 },
      oldestObservationAt: '2026-10-13T11:00:00.000Z',
    });
  });
});
