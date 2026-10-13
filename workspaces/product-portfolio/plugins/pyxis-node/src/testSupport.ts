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

import { ConfigReader } from '@backstage/config';
import { PyxisInventoryReader } from './inventory';
import { readPyxisConfig } from './config';
import type { PyxisReadClient } from './ports';
// Shared synthetic fixture is never a production package dependency.
// eslint-disable-next-line @backstage/no-relative-monorepo-imports
import baseline from '../../../test/fixtures/pyxis/baseline.json';

export const settings = readPyxisConfig(
  new ConfigReader({
    pyxis: {
      sources: {
        internal: {
          endpoint: 'https://pyxis.example.test/graphql',
          certificateFile: '/unused/cert',
          keyFile: '/unused/key',
        },
      },
    },
    catalog: { providers: { pyxis: { internal: {} } } },
  }),
);

export function fixtureClient(data = baseline): PyxisReadClient {
  const found = <T>(record?: T) =>
    record
      ? { state: 'found' as const, data: record }
      : {
          state: 'not-found' as const,
          authority: 'internal-source-404' as const,
        };

  return {
    listListings: jest.fn(async request => ({
      page: request.page,
      pageSize: request.pageSize,
      total: data.listings.length,
      data: data.listings.slice(
        request.page * request.pageSize,
        (request.page + 1) * request.pageSize,
      ),
    })),
    listRepositories: jest.fn(async request => ({
      page: request.page,
      pageSize: request.pageSize,
      total: data.repositories.length,
      data: data.repositories.slice(
        request.page * request.pageSize,
        (request.page + 1) * request.pageSize,
      ),
    })),
    listTeams: jest.fn(async request => ({
      page: request.page,
      pageSize: request.pageSize,
      total: data.teams.length,
      data: data.teams,
    })),
    getListing: jest.fn(async id =>
      found(data.listings.find(record => record._id === id)),
    ),
    getRepository: jest.fn(async id =>
      found(data.repositories.find(record => record._id === id)),
    ),
    getTeam: jest.fn(async id =>
      found(data.teams.find(record => record._id === id)),
    ),
    close: jest.fn(async () => {}),
  };
}

export const scanFixture = (client = fixtureClient()) =>
  new PyxisInventoryReader('internal', client, settings.sources.internal).scan(
    {},
  );

export { baseline };
