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

describe('Software Index relation resolution', () => {
  it.each([
    { mode: 'projected', fields: ['kind', 'metadata'] },
    { mode: 'unprojected', fields: undefined },
  ])(
    'lets the catalog client batch $mode reads and reports missing targets',
    async ({ fields }) => {
      const entity = fixtureEntity('listing');
      const first = fixtureEntity('repository', 1);
      const second = fixtureEntity('repository', 2);
      first.metadata.title = 'Zebra';
      second.metadata.title = 'Albatross';
      const entitiesByRef = new Map(
        [first, second].map(repository => [
          stringifyEntityRef(repository),
          repository,
        ]),
      );
      const refs = Array.from(
        { length: 201 },
        (_, i) => `resource:pyxis/repository-${i + 1}`,
      ).sort();
      entity.relations = [...refs, refs[0]].map(targetRef => ({
        type: 'pyxisHasRepository',
        targetRef,
      }));
      const getEntitiesByRefs = jest.fn(
        async ({ entityRefs }: { entityRefs: string[] }) => ({
          items: entityRefs.map(ref => entitiesByRef.get(ref)),
        }),
      );
      const wrapper = ({ children }: PropsWithChildren) => (
        <TestApiProvider apis={[[catalogApiRef, { getEntitiesByRefs }]]}>
          {children}
        </TestApiProvider>
      );
      const { result } = renderHook(
        () =>
          useRelatedEntities(
            entity,
            'pyxisHasRepository',
            fields ? { fields } : undefined,
          ),
        { wrapper },
      );
      expect(result.current.loading).toBe(true);
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(getEntitiesByRefs).toHaveBeenCalledTimes(1);
      expect(getEntitiesByRefs).toHaveBeenCalledWith({
        entityRefs: refs,
        fields,
      });
      expect(result.current.partial).toBe(true);
      expect(result.current.entities).toEqual([second, first]);
    },
  );
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

  it('drops stale results and stops requesting small batches when relation refs change', async () => {
    const firstRepository = fixtureEntity('repository', 1);
    const secondRepository = fixtureEntity('repository', 2);
    const firstParent = fixtureEntity('listing');
    firstParent.relations = [
      {
        type: 'owns',
        targetRef: stringifyEntityRef(firstRepository),
      },
      ...Array.from({ length: 100 }, (_, i) => ({
        type: 'owns',
        targetRef: `resource:pyxis/unavailable-${i}`,
      })),
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

    type BatchResponse = { items: Array<Entity | undefined> };
    let resolveFirstRequest!: (response: BatchResponse) => void;
    const firstRequest = new Promise<BatchResponse>(resolve => {
      resolveFirstRequest = resolve;
    });
    const getEntitiesByRefs = jest
      .fn<Promise<BatchResponse>, [{ entityRefs: string[] }]>()
      .mockReturnValueOnce(firstRequest)
      .mockResolvedValueOnce({ items: [secondRepository] });
    const wrapper = ({ children }: PropsWithChildren) => (
      <TestApiProvider apis={[[catalogApiRef, { getEntitiesByRefs }]]}>
        {children}
      </TestApiProvider>
    );
    const { result, rerender } = renderHook(
      ({ entity }: { entity: Entity }) =>
        useRelatedEntities(entity, 'owns', { smallBatches: true }),
      { initialProps: { entity: firstParent }, wrapper },
    );

    await waitFor(() => expect(getEntitiesByRefs).toHaveBeenCalledTimes(1));
    rerender({ entity: secondParent });
    expect(result.current).toMatchObject({ loading: true, entities: [] });

    await waitFor(() =>
      expect(result.current.entities).toEqual([secondRepository]),
    );
    await act(async () => {
      const [{ entityRefs }] = getEntitiesByRefs.mock.calls[0];
      resolveFirstRequest({
        items: entityRefs.map(ref =>
          ref === stringifyEntityRef(firstRepository)
            ? firstRepository
            : undefined,
        ),
      });
    });

    expect(result.current.entities).toEqual([secondRepository]);
    expect(
      getEntitiesByRefs.mock.calls.map(([{ entityRefs }]) => entityRefs.length),
    ).toEqual([100, 1]);
  });
});
