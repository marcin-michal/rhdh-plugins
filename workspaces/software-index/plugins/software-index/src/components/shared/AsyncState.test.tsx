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
import userEvent from '@testing-library/user-event';
import { fixtureEntity } from '../../testUtils/fixtures';
import type { RelatedState } from '../../hooks/useRelatedEntities';
import { AsyncState } from './AsyncState';

function state(overrides: Partial<RelatedState> = {}): RelatedState {
  return {
    loading: false,
    entities: [],
    partial: false,
    retry: jest.fn(),
    ...overrides,
  };
}

describe('AsyncState', () => {
  it('shows a loading status instead of children while resolving relations', async () => {
    await renderInTestApp(
      <AsyncState state={state({ loading: true })}>
        <p>Resolved content</p>
      </AsyncState>,
    );

    expect(
      screen.getByLabelText('Loading related catalog data'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Resolved content')).not.toBeInTheDocument();
  });

  it('shows a retry action when related data cannot be loaded', async () => {
    const user = userEvent.setup();
    const retry = jest.fn();
    await renderInTestApp(
      <AsyncState
        state={state({
          error: 'Related catalog data could not be loaded.',
          retry,
        })}
      >
        <p>Resolved content</p>
      </AsyncState>,
    );

    expect(
      screen.getByText('Related catalog data could not be loaded.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Resolved content')).not.toBeInTheDocument();
  });

  it('shows partial-data notice and the empty message when no entities resolved', async () => {
    await renderInTestApp(
      <AsyncState state={state({ partial: true })} empty="No repositories.">
        <p>Resolved content</p>
      </AsyncState>,
    );

    expect(
      screen.getByText('Some related catalog data is unavailable.'),
    ).toBeInTheDocument();
    expect(screen.getByText('No repositories.')).toBeInTheDocument();
  });

  it('keeps resolved content visible alongside the partial-data notice', async () => {
    await renderInTestApp(
      <AsyncState
        state={state({
          partial: true,
          entities: [fixtureEntity('repository')],
        })}
      >
        <p>Resolved content</p>
      </AsyncState>,
    );

    expect(
      screen.getByText('Some related catalog data is unavailable.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Resolved content')).toBeInTheDocument();
  });

  it('can hide the partial-data notice while keeping resolved content visible', async () => {
    await renderInTestApp(
      <AsyncState
        state={state({
          partial: true,
          entities: [fixtureEntity('repository')],
        })}
        showPartialWarning={false}
      >
        <p>Resolved content</p>
      </AsyncState>,
    );

    expect(
      screen.queryByText('Some related catalog data is unavailable.'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Resolved content')).toBeInTheDocument();
  });

  it('renders children when related entities are available', async () => {
    await renderInTestApp(
      <AsyncState state={state({ entities: [fixtureEntity('repository')] })}>
        <p>Resolved content</p>
      </AsyncState>,
    );

    expect(screen.getByText('Resolved content')).toBeInTheDocument();
    expect(
      screen.queryByText('No related catalog entities.'),
    ).not.toBeInTheDocument();
  });
});
