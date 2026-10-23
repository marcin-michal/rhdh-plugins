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

import { act, renderHook, waitFor } from '@testing-library/react';
import { TestApiProvider } from '@backstage/test-utils';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { stringifyEntityRef, type Entity } from '@backstage/catalog-model';
import type { PropsWithChildren } from 'react';
import { fixtureEntity } from '../testUtils/fixtures';
import { useRelatedEntities } from './useRelatedEntities';

describe('portfolio relation resolution', () => {
  it('batches at 100 and marks omitted refs partial', async () => {
    const entity = fixtureEntity('listing');
    entity.relations = Array.from({ length: 201 }, (_, i) => ({
      type: 'pyxisHasRepository',
      targetRef: `resource:pyxis/repository-${i + 1}`,
    }));
    const getEntitiesByRefs = jest.fn(async () => ({
      items: [fixtureEntity('repository')],
    }));
    const wrapper = ({ children }: PropsWithChildren) => (
      <TestApiProvider apis={[[catalogApiRef, { getEntitiesByRefs }]]}>
        {children}
      </TestApiProvider>
    );
    const { result } = renderHook(
      () => useRelatedEntities(entity, 'pyxisHasRepository'),
      { wrapper },
    );
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getEntitiesByRefs.mock.calls).toHaveLength(3);
    expect(result.current.partial).toBe(true);
    expect(result.current.entities).toHaveLength(1);
  });
  it('redacts request failures and retries without leaking error details', async () => {
    const entity = fixtureEntity('listing');
    entity.relations = [
      { type: 'pyxisHasRepository', targetRef: 'resource:pyxis/repository-1' },
    ];
    const getEntitiesByRefs = jest
      .fn()
      .mockRejectedValueOnce(new Error('private credential'))
      .mockResolvedValue({ items: [fixtureEntity('repository')] });
    const wrapper = ({ children }: PropsWithChildren) => (
      <TestApiProvider apis={[[catalogApiRef, { getEntitiesByRefs }]]}>
        {children}
      </TestApiProvider>
    );
    const { result } = renderHook(
      () => useRelatedEntities(entity, 'pyxisHasRepository'),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.error).toBe(
        'Related catalog data could not be loaded.',
      ),
    );
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.entities).toHaveLength(1));
    expect(result.current.error).toBeUndefined();
  });

  it('resolves an entity with no matching relations as an empty result without a request', async () => {
    const entity = fixtureEntity('listing');
    const getEntitiesByRefs = jest.fn();
    const wrapper = ({ children }: PropsWithChildren) => (
      <TestApiProvider apis={[[catalogApiRef, { getEntitiesByRefs }]]}>
        {children}
      </TestApiProvider>
    );
    const { result } = renderHook(
      () => useRelatedEntities(entity, 'pyxisHasRepository'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entities).toEqual([]);
    expect(getEntitiesByRefs).not.toHaveBeenCalled();
  });

  it('drops stale results and clears the previous entity list when relation refs change', async () => {
    const firstRepository = fixtureEntity('repository', 1);
    const secondRepository = fixtureEntity('repository', 2);
    const firstParent = fixtureEntity('listing');
    firstParent.relations = [
      {
        type: 'owns',
        targetRef: stringifyEntityRef(firstRepository),
      },
    ];
    const secondParent = {
      ...firstParent,
      relations: [
        {
          type: 'owns',
          targetRef: stringifyEntityRef(secondRepository),
        },
      ],
    };

    let resolveFirstRequest!: (response: { items: Entity[] }) => void;
    const firstRequest = new Promise<{ items: Entity[] }>(resolve => {
      resolveFirstRequest = resolve;
    });
    const getEntitiesByRefs = jest
      .fn()
      .mockReturnValueOnce(firstRequest)
      .mockResolvedValueOnce({ items: [secondRepository] });
    const wrapper = ({ children }: PropsWithChildren) => (
      <TestApiProvider apis={[[catalogApiRef, { getEntitiesByRefs }]]}>
        {children}
      </TestApiProvider>
    );
    const { result, rerender } = renderHook(
      ({ entity }: { entity: Entity }) => useRelatedEntities(entity, 'owns'),
      { initialProps: { entity: firstParent }, wrapper },
    );

    await waitFor(() => expect(getEntitiesByRefs).toHaveBeenCalledTimes(1));
    rerender({ entity: secondParent });
    expect(result.current).toMatchObject({ loading: true, entities: [] });

    await waitFor(() =>
      expect(result.current.entities).toEqual([secondRepository]),
    );
    await act(async () => {
      resolveFirstRequest({ items: [firstRepository] });
    });

    expect(result.current.entities).toEqual([secondRepository]);
  });
});
