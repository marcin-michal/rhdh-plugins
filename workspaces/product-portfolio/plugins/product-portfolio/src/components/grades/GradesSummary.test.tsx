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

import { renderInTestApp } from '@backstage/test-utils';
import { screen } from '@testing-library/react';
import type { RelatedState } from '../../hooks/useRelatedEntities';
import {
  fixtureEntity,
  fixtureHealth,
  observedAt,
} from '../../testUtils/fixtures';
import { GradesSummary } from './GradesSummary';

function relatedState(overrides: Partial<RelatedState> = {}): RelatedState {
  return {
    loading: false,
    entities: [],
    partial: false,
    retry: jest.fn(),
    ...overrides,
  };
}

async function renderSummary(state: RelatedState) {
  await renderInTestApp(<GradesSummary state={state} />);
}

describe('GradesSummary', () => {
  it('shows the last observation time without status or warning notices', async () => {
    const repository = fixtureEntity('repository');
    repository.spec!.pyxisChi = JSON.parse(
      JSON.stringify(fixtureHealth(repository, 'partial', 'B')),
    );

    await renderSummary(
      relatedState({ entities: [repository], partial: true }),
    );

    expect(screen.getByText('Latest grade observation')).toBeInTheDocument();
    expect(
      document.querySelector(`time[datetime="${observedAt}"]`),
    ).toBeInTheDocument();
    expect(screen.queryByText('Observation status')).not.toBeInTheDocument();
    expect(screen.queryByText('Incomplete')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Some related catalog data is unavailable.'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        'These grade counts are based on incomplete repository observations.',
      ),
    ).not.toBeInTheDocument();
  });

  it('keeps the loading state without showing observation status', async () => {
    await renderSummary(relatedState({ loading: true }));

    expect(
      screen.getByLabelText('Loading related catalog data'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Observation status')).not.toBeInTheDocument();
  });

  it('keeps the error state without showing observation status', async () => {
    await renderSummary(
      relatedState({ error: 'Related catalog data could not be loaded.' }),
    );

    expect(
      screen.getByText('Related catalog data could not be loaded.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText('Observation status')).not.toBeInTheDocument();
  });

  it('keeps the empty state and last-observation placeholder', async () => {
    await renderSummary(relatedState());

    expect(
      screen.getByText('No repository observations available.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Latest grade observation')).toBeInTheDocument();
    expect(screen.getByText('Not available')).toBeInTheDocument();
    expect(screen.queryByText('Observation status')).not.toBeInTheDocument();
  });
});
