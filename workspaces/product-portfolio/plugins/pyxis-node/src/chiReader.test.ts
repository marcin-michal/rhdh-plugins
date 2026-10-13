/*
 * Copyright Red Hat, Inc.
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

import type {
  ChiCandidate,
  PyxisChiReadClient,
  RepositoryChiContext,
  SelectedImageChi,
} from './ports';
import { RepositoryChiReader } from './chiReader';
import { settings } from './testSupport';

const repositoryId = '200000000000000000000001';
const oldImage = '300000000000000000000001';
const newImage = '300000000000000000000002';
const now = Date.now();

const context = (
  changes: Partial<RepositoryChiContext> = {},
): RepositoryChiContext => ({
  id: repositoryId,
  registry: 'registry.redhat.io',
  repository: 'example/component',
  vendor: { wirePresence: 'present', wireValue: 'redhat' },
  published: true,
  hiddenUntil: null,
  sourceUpdatedAt: null,
  contentStreamTags: ['9.4-extended'],
  includesMultipleContentStreams: true,
  ...changes,
});

const candidate = (id: string, pushDate: string): ChiCandidate => ({
  _id: id,
  architecture: 'amd64',
  deleted: false,
  repositories: [
    {
      registry: 'registry.redhat.io',
      repository: 'example/component',
      published: true,
      push_date: pushDate,
      tags: [
        {
          name: '9.4-extended',
          added_date: '2026-10-01T00:00:00Z',
          removed_date: null,
        },
      ],
    },
  ],
});

const selected = (
  value: ChiCandidate,
  freshness_grades: unknown = [],
): SelectedImageChi => ({ ...value, freshness_grades });

const harness = (pages: ChiCandidate[][]) => {
  const contexts = [context(), context()];
  const all = pages.flat();
  const client: PyxisChiReadClient = {
    getRepositoryChiContext: jest.fn(async () => ({
      state: 'found' as const,
      data: contexts.shift() ?? context(),
    })),
    listRepositoryChiCandidates: jest.fn(async request => ({
      data: pages.shift() ?? [],
      page: 0 as const,
      pageSize: request.pageSize,
    })),
    getSelectedImageChi: jest.fn(async id => ({
      state: 'found' as const,
      data: selected(all.find(value => value._id === id)!),
    })),
  };
  const sourceConfig = { ...settings.sources.internal, pageSize: 2 };
  const reader = new RepositoryChiReader(
    'internal',
    client,
    sourceConfig,
    settings.providers.internal.chi,
    'redhat-only',
    () => now,
  );
  return { reader, client, contexts };
};

const source = {
  sourceInstance: 'internal',
  kind: 'repository' as const,
  id: repositoryId,
};

describe('chi-candidate-keyset chi-winner-revalidation repository reader', () => {
  it('exhausts keyset pages and selects the latest image without grade fallback', async () => {
    const old = candidate(oldImage, '2026-10-10T00:00:00Z');
    const latest = candidate(newImage, '2026-10-12T00:00:00Z');
    const h = harness([[old, latest], []]);
    const result = await h.reader.readRepository(source, {});

    expect(result).toMatchObject({
      state: 'complete',
      snapshot: {
        population: 'latest-published-per-stream-architecture',
        coverage: { candidatePages: 2, candidateRecords: 2 },
        counts: { total: 1, byGrade: { unknown: 1 } },
      },
    });
    expect(jest.mocked(h.client.getSelectedImageChi)).toHaveBeenCalledTimes(1);
    expect(jest.mocked(h.client.getSelectedImageChi)).toHaveBeenCalledWith(
      newImage,
      expect.objectContaining({ includeGrades: true }),
    );
    expect(
      jest.mocked(h.client.listRepositoryChiCandidates).mock.calls[1][0]
        .afterId,
    ).toBe(newImage);
  });

  it('never publishes prefix winners after a later-page failure', async () => {
    const h = harness([
      [
        candidate(oldImage, '2026-10-10T00:00:00Z'),
        candidate(newImage, '2026-10-12T00:00:00Z'),
      ],
    ]);
    jest
      .mocked(h.client.listRepositoryChiCandidates)
      .mockResolvedValueOnce({
        data: [
          candidate(oldImage, '2026-10-10T00:00:00Z'),
          candidate(newImage, '2026-10-12T00:00:00Z'),
        ],
        page: 0,
        pageSize: 2,
      })
      .mockRejectedValueOnce(new Error('later page failed'));
    await expect(h.reader.readRepository(source, {})).resolves.toMatchObject({
      state: 'unavailable',
      code: 'validation',
    });
    expect(h.client.getSelectedImageChi).not.toHaveBeenCalled();
  });

  it('fails the whole refresh when the selected association changes', async () => {
    const latest = candidate(newImage, '2026-10-12T00:00:00Z');
    const h = harness([[latest]]);
    jest.mocked(h.client.getSelectedImageChi).mockResolvedValue({
      state: 'found',
      data: selected({
        ...latest,
        repositories: [
          { ...latest.repositories[0], push_date: '2026-10-11T00:00:00Z' },
        ],
      }),
    });
    await expect(h.reader.readRepository(source, {})).resolves.toMatchObject({
      state: 'unavailable',
      code: 'selection-changed',
    });
  });

  it('omits grade reads and masks schedules while hiding is active', async () => {
    const latest = candidate(newImage, '2026-10-12T00:00:00Z');
    const h = harness([[latest]]);
    jest.mocked(h.client.getRepositoryChiContext).mockResolvedValue({
      state: 'found',
      data: context({ hiddenUntil: '2026-10-14T00:00:00.000Z' }),
    });
    const result = await h.reader.readRepository(source, {});
    expect(result).toMatchObject({
      state: 'complete',
      snapshot: {
        coverage: { grades: 'hidden' },
        images: [{ gradeQuality: 'hidden', periods: [] }],
      },
    });
    expect(h.client.getSelectedImageChi).toHaveBeenCalledWith(
      newImage,
      expect.objectContaining({ includeGrades: false }),
    );
  });

  it('uses the marked latest fallback when a single-stream repository has no tags', async () => {
    const h = harness([[]]);
    jest.mocked(h.client.getRepositoryChiContext).mockResolvedValue({
      state: 'found',
      data: context({
        contentStreamTags: null,
        includesMultipleContentStreams: false,
      }),
    });
    const result = await h.reader.readRepository(source, {});
    expect(result).toMatchObject({
      state: 'complete',
      snapshot: {
        streamPolicy: { tags: ['latest'], origin: 'latest-fallback' },
        streams: [{ tag: 'latest', issues: ['no-published-candidate'] }],
      },
    });
  });

  it('reports unconfigured multi-stream context without fabricating counts', async () => {
    const h = harness([]);
    jest.mocked(h.client.getRepositoryChiContext).mockResolvedValue({
      state: 'found',
      data: context({
        contentStreamTags: null,
        includesMultipleContentStreams: true,
      }),
    });
    const result = await h.reader.readRepository(source, {});
    expect(result).toMatchObject({
      state: 'complete',
      snapshot: {
        streamPolicy: { tags: [], origin: 'unconfigured' },
        issues: ['streams-not-configured'],
        counts: { total: 0 },
        coverage: { selection: 'partial' },
      },
    });
    expect(h.client.listRepositoryChiCandidates).not.toHaveBeenCalled();
  });
});
