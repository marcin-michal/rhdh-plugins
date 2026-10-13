/*
 * Copyright Red Hat, Inc.
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

import { ConfigReader } from '@backstage/config';
import { MockAgent } from 'undici';
import { PyxisClient } from './client';
import { readPyxisConfig } from './config';

const endpoint = 'https://pyxis.example.test';
const repositoryId = '200000000000000000000001';
const imageId = '300000000000000000000001';
const config = readPyxisConfig(
  new ConfigReader({
    pyxis: {
      sources: {
        internal: {
          endpoint: `${endpoint}/graphql`,
          certificateFile: '/unused',
          keyFile: '/unused',
          maxAttempts: 1,
        },
      },
    },
  }),
).sources.internal;

const response = (operation: string, data: unknown, extra: object = {}) => ({
  data: { [operation]: { error: null, data, ...extra } },
});

describe('chi-source-contract exact minimal CHI GraphQL operations', () => {
  let agent: MockAgent;
  let client: PyxisClient;

  beforeEach(() => {
    agent = new MockAgent();
    agent.disableNetConnect();
    client = new PyxisClient(config, agent, 'internal', () => 0);
  });

  afterEach(async () => {
    agent.assertNoPendingInterceptors();
    await client.close();
  });

  it('reads repository context with ObjectIDFilterScalar', async () => {
    agent
      .get(endpoint)
      .intercept({
        path: '/graphql',
        method: 'POST',
        body: body => {
          const request = JSON.parse(String(body));
          expect(request.variables).toEqual({ id: repositoryId });
          expect(request.query).toContain(
            'query RepositoryChiContext($id: ObjectIDFilterScalar!)',
          );
          expect(request.query).not.toContain('freshness_grades {');
          return true;
        },
      })
      .reply(
        200,
        response('get_repository', {
          _id: repositoryId,
          registry: 'registry.redhat.io',
          repository: 'example/component',
          vendor_label: 'redhat',
          published: true,
          last_update_date: null,
          freshness_grades_unknown_until_date: null,
          content_stream_tags: ['9.4-extended'],
          includes_multiple_content_streams: true,
        }),
      );
    await expect(
      client.getRepositoryChiContext(repositoryId, {}),
    ).resolves.toMatchObject({
      state: 'found',
      data: { contentStreamTags: ['9.4-extended'] },
    });
  });

  it('uses a same-association keyset filter and omits total', async () => {
    agent
      .get(endpoint)
      .intercept({
        path: '/graphql',
        method: 'POST',
        body: body => {
          const request = JSON.parse(String(body));
          expect(request.query).toContain(
            'find_repository_images_by_registry_path',
          );
          expect(request.query).not.toMatch(/\btotal\b/);
          expect(request.variables.filter.and).toContainEqual({
            _id: { gt: imageId },
          });
          expect(request.variables.filter.and[1]).toEqual({
            repositories_elemMatch: {
              and: [
                { registry: { eq: 'registry.redhat.io' } },
                { repository: { eq: 'example/component' } },
                { published: { eq: true } },
                {
                  tags_elemMatch: {
                    and: [
                      { name: { in: ['9.4-extended'] } },
                      { removed_date: { eq: null } },
                    ],
                  },
                },
              ],
            },
          });
          return true;
        },
      })
      .reply(
        200,
        response('find_repository_images_by_registry_path', [], {
          page: 0,
          page_size: 100,
        }),
      );
    await expect(
      client.listRepositoryChiCandidates({
        registry: 'registry.redhat.io',
        repository: 'example/component',
        streams: ['9.4-extended'],
        afterId: imageId,
        pageSize: 100,
      }),
    ).resolves.toEqual({ data: [], page: 0, pageSize: 100 });
  });

  it('fetches only selected metadata and conditionally includes periods', async () => {
    agent
      .get(endpoint)
      .intercept({
        path: '/graphql',
        method: 'POST',
        body: body => {
          const request = JSON.parse(String(body));
          expect(request.variables).toEqual({
            id: imageId,
            includeGrades: false,
          });
          expect(request.query).toContain(
            'freshness_grades @include(if: $includeGrades)',
          );
          return true;
        },
      })
      .reply(
        200,
        response('get_image', {
          _id: imageId,
          architecture: 'amd64',
          deleted: false,
          repositories: [],
        }),
      );
    await expect(
      client.getSelectedImageChi(imageId, { includeGrades: false }),
    ).resolves.toMatchObject({ state: 'found', data: { _id: imageId } });
  });
});
