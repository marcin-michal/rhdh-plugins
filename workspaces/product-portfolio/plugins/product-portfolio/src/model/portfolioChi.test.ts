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
  fixtureEntity,
  fixtureHealth,
  observedAt,
} from '../testUtils/fixtures';
import {
  collectPortfolioChiData,
  summarizePortfolioChiData,
} from './portfolioChi';

describe('portfolio CHI data', () => {
  it('reuses grade buckets while refreshing time-dependent quality', () => {
    const repository = fixtureEntity('repository');
    repository.spec!.pyxisChi = JSON.parse(
      JSON.stringify(fixtureHealth(repository)),
    );
    const data = collectPortfolioChiData([repository]);
    const staleAt =
      Date.parse(observedAt) +
      data.inputs[0].projection!.staleAfterSeconds * 1000;

    const freshSummary = summarizePortfolioChiData(data, staleAt - 1);
    const staleSummary = summarizePortfolioChiData(data, staleAt);

    expect(freshSummary.aggregate.repositories.stale).toBe(0);
    expect(staleSummary.aggregate.repositories.stale).toBe(1);
    expect(staleSummary.buckets).toBe(data.buckets);
    expect(staleSummary.buckets).toBe(freshSummary.buckets);
  });
});
