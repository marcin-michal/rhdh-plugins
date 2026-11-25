/*
 * Copyright Red Hat, Inc.
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

import type {
  ChiImageMetadata,
  RepositoryChiSnapshot,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import type { ChiSelectionWinner } from './chiSelection';
import {
  countChiImages,
  hashChiSnapshotEvidence,
  normalizeChiImage,
  summarizeChiStreams,
} from './chiNormalization';

const winner = (
  imageId: string,
  architecture = 'amd64',
): ChiSelectionWinner & ChiImageMetadata => ({
  imageId,
  architecture,
  selectedIn: ['9.4'],
  pushDates: { '9.4': '2026-10-12T00:00:00.000Z' },
  fingerprints: { '9.4': 'fingerprint' },
  activeTags: ['9.4'],
  manifestDigest: null,
  manifestListDigest: null,
  publishedAt: null,
});
const observedAt = '2026-10-13T12:00:00.000Z';

describe('chi period normalization and attention', () => {
  it('uses half-open periods and recognizes a contiguous deterioration', () => {
    const image = normalizeChiImage(
      winner('000000000000000000000001'),
      [
        {
          grade: 'A',
          start_date: '2026-10-01T00:00:00Z',
          end_date: '2026-10-20T00:00:00Z',
          creation_date: null,
        },
        {
          grade: 'C',
          start_date: '2026-10-20T00:00:00Z',
          end_date: null,
          creation_date: '2026-10-01T00:00:00+00:00',
        },
      ],
      observedAt,
      false,
      32,
    );
    expect(image).toMatchObject({
      currentGrade: 'A',
      gradeQuality: 'known',
      attention: 'warning',
      futureDrops: [{ from: 'A', to: 'C', at: '2026-10-20T00:00:00.000Z' }],
    });
  });

  it('keeps an unknown latest winner instead of substituting another image', () => {
    const image = normalizeChiImage(
      winner('000000000000000000000002'),
      [],
      observedAt,
      false,
      32,
    );
    expect(image).toMatchObject({
      imageId: '000000000000000000000002',
      currentGrade: null,
      gradeQuality: 'unknown',
      attention: 'unknown',
    });
  });

  it('rejects conflicting overlap as inconsistent evidence', () => {
    const image = normalizeChiImage(
      winner('000000000000000000000003'),
      [
        {
          grade: 'A',
          start_date: '2026-10-01T00:00:00Z',
          end_date: '2026-11-01T00:00:00Z',
        },
        {
          grade: 'B',
          start_date: '2026-10-10T00:00:00Z',
          end_date: null,
        },
      ],
      observedAt,
      false,
      32,
    );
    expect(image).toMatchObject({
      currentGrade: null,
      gradeQuality: 'inconsistent',
      periods: [],
    });
  });

  it('masks raw schedules when repository hiding is active', () => {
    const image = normalizeChiImage(
      winner('000000000000000000000004'),
      [{ grade: 'A', start_date: '2026-10-01T00:00:00Z' }],
      observedAt,
      true,
      32,
    );
    expect(image).toMatchObject({
      gradeQuality: 'hidden',
      periodEvidence: 'hidden',
      periods: [],
    });
  });

  it.each([
    ['not-an-array', 'inconsistent'],
    [[{ nope: true }], 'inconsistent'],
    [[{ grade: 'A', start_date: 'not-a-date' }], 'inconsistent'],
    [[{ grade: 'A', start_date: '2026-10-13T99:00:00Z' }], 'inconsistent'],
    [[{ grade: 'A', start_date: '2026-02-30T00:00:00Z' }], 'inconsistent'],
    [
      [
        {
          grade: 'A',
          start_date: '2026-10-01T00:00:00Z',
          end_date: 'not-a-date',
        },
      ],
      'inconsistent',
    ],
    [
      [
        {
          grade: 'A',
          start_date: '2026-10-01T00:00:00Z',
          creation_date: 'not-a-date',
        },
      ],
      'inconsistent',
    ],
    [
      [
        {
          grade: 'A',
          start_date: '2026-10-02T00:00:00Z',
          end_date: '2026-10-01T00:00:00Z',
        },
      ],
      'inconsistent',
    ],
  ] as const)('marks malformed period evidence %#', (raw, quality) => {
    expect(
      normalizeChiImage(
        winner('000000000000000000000010'),
        raw,
        observedAt,
        false,
        32,
      ).gradeQuality,
    ).toBe(quality);
  });

  it('enforces the period limit', () => {
    expect(() =>
      normalizeChiImage(
        winner('000000000000000000000011'),
        [
          { grade: 'A', start_date: '2026-10-01T00:00:00Z' },
          { grade: 'A', start_date: '2026-10-02T00:00:00Z' },
        ],
        observedAt,
        false,
        1,
      ),
    ).toThrow('period-limit');
  });

  it('collapses exact duplicates and preserves consistent overlapping provenance', () => {
    const period = {
      grade: 'B',
      start_date: '2026-10-01T00:00:00Z',
      end_date: '2026-10-20T00:00:00Z',
      creation_date: '2026-09-01T00:00:00Z',
    };
    const image = normalizeChiImage(
      winner('000000000000000000000012'),
      [
        period,
        period,
        { ...period, creation_date: '2026-09-02T00:00:00Z' },
        {
          grade: 'B',
          start_date: '2026-10-02T00:00:00Z',
          end_date: '2026-10-19T00:00:00Z',
        },
      ],
      observedAt,
      false,
      32,
    );
    expect(image.periods).toHaveLength(3);
    expect(image).toMatchObject({ currentGrade: 'B', attention: 'warning' });
  });

  it('deterministically orders null endpoints, grades and creation provenance', () => {
    const cases = [
      [
        {
          grade: 'A',
          start_date: '2026-10-01T00:00:00Z',
          end_date: null,
          creation_date: null,
        },
        {
          grade: 'A',
          start_date: '2026-10-01T00:00:00Z',
          end_date: '2026-10-20T00:00:00Z',
          creation_date: null,
        },
      ],
      [
        {
          grade: 'A',
          start_date: '2026-10-01T00:00:00Z',
          end_date: '2026-10-20T00:00:00Z',
          creation_date: null,
        },
        {
          grade: 'A',
          start_date: '2026-10-01T00:00:00Z',
          end_date: null,
          creation_date: null,
        },
      ],
      [
        {
          grade: 'B',
          start_date: '2026-10-01T00:00:00Z',
          end_date: '2026-10-20T00:00:00Z',
          creation_date: null,
        },
        {
          grade: 'A',
          start_date: '2026-10-01T00:00:00Z',
          end_date: '2026-10-20T00:00:00Z',
          creation_date: null,
        },
      ],
      [
        {
          grade: 'A',
          start_date: '2026-10-01T00:00:00Z',
          end_date: '2026-10-20T00:00:00Z',
          creation_date: '2026-09-01T00:00:00Z',
        },
        {
          grade: 'A',
          start_date: '2026-10-01T00:00:00Z',
          end_date: '2026-10-20T00:00:00Z',
          creation_date: null,
        },
      ],
      [
        {
          grade: 'A',
          start_date: '2026-10-01T00:00:00Z',
          end_date: '2026-10-20T00:00:00Z',
          creation_date: null,
        },
        {
          grade: 'A',
          start_date: '2026-10-01T00:00:00Z',
          end_date: '2026-10-20T00:00:00Z',
          creation_date: '2026-09-01T00:00:00Z',
        },
      ],
    ];
    for (const periods of cases) {
      expect(
        normalizeChiImage(
          winner('000000000000000000000020'),
          periods,
          observedAt,
          false,
          32,
        ).periodEvidence,
      ).toMatch(/valid|inconsistent/);
    }
  });

  it('sorts multiple identical source-evidenced drops', () => {
    const image = normalizeChiImage(
      winner('000000000000000000000021'),
      [
        {
          grade: 'A',
          start_date: '2026-10-01T00:00:00Z',
          end_date: '2026-10-20T00:00:00Z',
          creation_date: '2026-09-01T00:00:00Z',
        },
        {
          grade: 'A',
          start_date: '2026-10-01T00:00:00Z',
          end_date: '2026-10-20T00:00:00Z',
          creation_date: '2026-09-02T00:00:00Z',
        },
        {
          grade: 'B',
          start_date: '2026-10-20T00:00:00Z',
          end_date: '2026-11-01T00:00:00Z',
        },
        {
          grade: 'C',
          start_date: '2026-11-01T00:00:00Z',
          end_date: null,
        },
      ],
      observedAt,
      false,
      32,
    );
    expect(image.futureDrops).toHaveLength(3);
  });

  it('keeps valid gaps and improvements without inventing drops', () => {
    const image = normalizeChiImage(
      winner('000000000000000000000013'),
      [
        {
          grade: 'C',
          start_date: '2026-09-01T00:00:00Z',
          end_date: '2026-09-10T00:00:00Z',
        },
        {
          grade: 'A',
          start_date: '2026-10-20T00:00:00Z',
          end_date: null,
        },
      ],
      observedAt,
      false,
      32,
    );
    expect(image).toMatchObject({
      currentGrade: null,
      gradeQuality: 'unknown',
      periodEvidence: 'valid',
      futureDrops: [],
      attention: 'unknown',
    });
  });
});

describe('chi counts and stream summaries', () => {
  it('counts A through F and unknown images exactly once', () => {
    const grades = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
    const images = grades.map((grade, index) =>
      normalizeChiImage(
        winner(`00000000000000000000000${index + 1}`),
        [{ grade, start_date: '2026-10-01T00:00:00Z' }],
        observedAt,
        false,
        32,
      ),
    );
    images.push(
      normalizeChiImage(
        winner('000000000000000000000007'),
        [],
        observedAt,
        false,
        32,
      ),
    );
    expect(countChiImages(images)).toEqual({
      total: 7,
      byGrade: { A: 1, B: 1, C: 1, D: 1, E: 1, F: 1, unknown: 1 },
      aWithScheduledDrop: 0,
      byAttention: { ok: 1, warning: 2, problem: 3, unknown: 1 },
    });
  });

  it('does not infer complete architecture coverage from observed slots', () => {
    const image = normalizeChiImage(
      winner('000000000000000000000008'),
      [{ grade: 'A', start_date: '2026-10-01T00:00:00Z' }],
      observedAt,
      false,
      32,
    );
    const streams = summarizeChiStreams(
      {
        streams: [
          {
            tag: '9.4',
            architectures: {
              basis: 'observed-only',
              expected: null,
              observed: ['amd64'],
              missing: [],
            },
            slots: [
              {
                architecture: 'amd64',
                state: 'selected',
                imageId: image.imageId,
                pushDate: '2026-10-12T00:00:00.000Z',
                reason: null,
              },
            ],
            issues: [],
          },
        ],
        winners: [],
        issues: [],
        complete: true,
      },
      [image],
    );
    expect(streams[0]).toMatchObject({
      worstKnownGrade: 'A',
      counts: { total: 1 },
      architectures: { basis: 'observed-only' },
    });
  });

  it('deduplicates counts and classifies scheduled A separately', () => {
    const scheduled = normalizeChiImage(
      winner('000000000000000000000009'),
      [
        {
          grade: 'A',
          start_date: '2026-10-01T00:00:00Z',
          end_date: '2026-10-20T00:00:00Z',
        },
        {
          grade: 'D',
          start_date: '2026-10-20T00:00:00Z',
          end_date: null,
        },
      ],
      observedAt,
      false,
      32,
    );
    expect(countChiImages([scheduled, scheduled])).toMatchObject({
      total: 1,
      byGrade: { A: 1 },
      aWithScheduledDrop: 1,
      byAttention: { warning: 1 },
    });
  });

  it('sorts worst grades and equal-time stream drops deterministically', () => {
    const first = {
      ...normalizeChiImage(
        winner('000000000000000000000014', 'arm64'),
        [{ grade: 'F', start_date: '2026-10-01T00:00:00Z' }],
        observedAt,
        false,
        32,
      ),
      futureDrops: [
        {
          from: 'A' as const,
          to: 'B' as const,
          at: '2026-10-20T00:00:00.000Z',
        },
        {
          from: 'A' as const,
          to: 'C' as const,
          at: '2026-10-20T00:00:00.000Z',
        },
      ],
    };
    const second = {
      ...normalizeChiImage(
        winner('000000000000000000000013', 'amd64'),
        [{ grade: 'B', start_date: '2026-10-01T00:00:00Z' }],
        observedAt,
        false,
        32,
      ),
      futureDrops: [
        {
          from: 'A' as const,
          to: 'C' as const,
          at: '2026-10-20T00:00:00.000Z',
        },
      ],
    };
    const plan = {
      streams: [
        {
          tag: '9.4',
          architectures: {
            basis: 'observed-only' as const,
            expected: null,
            observed: ['amd64', 'arm64'],
            missing: [],
          },
          slots: [
            {
              architecture: 'arm64',
              state: 'selected' as const,
              imageId: first.imageId,
              pushDate: '2026-10-12T00:00:00.000Z',
              reason: null,
            },
            {
              architecture: 'amd64',
              state: 'selected' as const,
              imageId: second.imageId,
              pushDate: '2026-10-12T00:00:00.000Z',
              reason: null,
            },
          ],
          issues: [],
        },
      ],
      winners: [],
      issues: [],
      complete: true,
    };
    expect(summarizeChiStreams(plan, [first, second])[0]).toMatchObject({
      worstKnownGrade: 'F',
      earliestDrop: {
        imageId: '000000000000000000000013',
        architecture: 'amd64',
      },
    });
  });

  it('summarizes unknown-only selections and hashes source evidence', () => {
    const unknown = normalizeChiImage(
      winner('000000000000000000000022'),
      [],
      observedAt,
      false,
      32,
    );
    const plan = {
      streams: [
        {
          tag: '9.4',
          architectures: {
            basis: 'observed-only' as const,
            expected: null,
            observed: ['amd64'],
            missing: [],
          },
          slots: [
            {
              architecture: 'amd64',
              state: 'selected' as const,
              imageId: unknown.imageId,
              pushDate: '2026-10-12T00:00:00.000Z',
              reason: null,
            },
          ],
          issues: [],
        },
      ],
      winners: [],
      issues: [],
      complete: true,
    };
    const streams = summarizeChiStreams(plan, [unknown]);
    expect(streams[0]).toMatchObject({
      worstKnownGrade: null,
      earliestDrop: null,
    });
    const snapshot: RepositoryChiSnapshot = {
      schemaVersion: '2',
      normalizationVersion: 'pyxis-chi-v2',
      population: 'latest-published-per-stream-architecture',
      source: {
        sourceInstance: 'internal',
        kind: 'repository',
        id: '200000000000000000000001',
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
        selection: 'complete',
        architectureExpectations: 'unverified',
        grades: 'partial',
        candidatePages: 1,
        candidateRecords: 1,
      },
      issues: [],
      contentHash: '',
      streams,
      images: [unknown],
      counts: countChiImages([unknown]),
    };
    const hash = hashChiSnapshotEvidence(snapshot);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      hashChiSnapshotEvidence({
        ...snapshot,
        images: [{ ...unknown, activeTags: ['9.4', '9.4.1'] }],
      }),
    ).not.toBe(hash);
  });
});
