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

import { stringifyEntityRef, type Entity } from '@backstage/catalog-model';
import {
  catalogApiRef,
  EntityProvider,
  entityRouteRef,
} from '@backstage/plugin-catalog-react';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PYXIS_RELATIONS } from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import { Route, Routes } from 'react-router-dom';
import type { RelatedState } from '../../hooks/useRelatedEntities';
import {
  fixtureEntity,
  fixtureHealth,
  observedAt,
  teamPortfolioFixtures,
} from '../../testUtils/fixtures';
import { ListingOverview } from '../product-listing/Overview';
import { TeamOverview } from '../team/Overview';
import { Grades } from './Grades';
import { GradesSummary } from './GradesSummary';

function selectCatalogFields(entity: Entity, fields: string[]): Entity {
  const selected: Record<string, unknown> = {};

  for (const field of fields) {
    const path = field.split('.');
    const value = path.reduce<unknown>(
      (source, key) => (source as Record<string, unknown> | null)?.[key],
      entity,
    );
    if (value === undefined) {
      continue;
    }

    let target = selected;
    for (const key of path.slice(0, -1)) {
      target[key] ??= {};
      target = target[key] as Record<string, unknown>;
    }
    target[path.at(-1)!] = value;
  }

  return selected as unknown as Entity;
}

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
  it.each([
    ['listing-1', '/catalog/pyxis/resource/listing-1', ListingOverview, 0],
    ['team-1', '/catalog/pyxis/group/team-1', TeamOverview, 1],
  ] as const)(
    'opens the matching section from the projected grade counts for %s',
    async (name, href, Overview, directOnlyGradeCount) => {
      const user = userEvent.setup();
      const entities = teamPortfolioFixtures();
      const entity = entities.find(
        candidate => candidate.metadata.name === name,
      )!;
      const listing = entities.find(
        candidate => candidate.metadata.name === 'listing-1',
      )!;
      const repository = entities.find(
        candidate => candidate.metadata.name === 'repository-1',
      )!;
      const health = fixtureHealth(repository, 'partial', 'A');
      health.snapshot!.images[0].futureDrops = [
        { from: 'A', to: 'B', at: '2099-01-01T00:00:00.000Z' },
      ];
      health.snapshot!.counts.aWithScheduledDrop = 1;
      repository.spec!.pyxisChi = JSON.parse(JSON.stringify(health));

      const hidden = fixtureEntity('repository', 7);
      // A hidden projection can still carry a previous snapshot.
      const hiddenHealth = fixtureHealth(hidden, 'ready', 'D');
      hiddenHealth.state = 'hidden';
      const latest = '2026-11-01T00:00Z';
      hiddenHealth.snapshot!.observedAt = latest;
      hidden.spec!.pyxisChi = JSON.parse(JSON.stringify(hiddenHealth));
      listing.relations!.push({
        type: PYXIS_RELATIONS.hasRepository,
        targetRef: stringifyEntityRef(hidden),
      });
      for (let i = 0; i < 100; i++) {
        listing.relations!.push({
          type: PYXIS_RELATIONS.hasRepository,
          targetRef: `resource:pyxis/inaccessible-linked-${i}`,
        });
        if (name === 'team-1') {
          entity.relations!.push({
            type: 'ownerOf',
            targetRef: `resource:pyxis/inaccessible-owned-${i}`,
          });
        }
      }

      const entitiesByRef = new Map(
        [...entities, hidden].map(candidate => [
          stringifyEntityRef(candidate),
          candidate,
        ]),
      );
      const getEntitiesByRefs = jest.fn(
        async ({
          entityRefs,
          fields,
        }: {
          entityRefs: string[];
          fields?: string[];
        }) => ({
          items: entityRefs.map(ref => {
            const candidate = entitiesByRef.get(ref);
            return candidate && fields
              ? selectCatalogFields(candidate, fields)
              : candidate;
          }),
        }),
      );

      await renderInTestApp(
        <TestApiProvider apis={[[catalogApiRef, { getEntitiesByRefs }]]}>
          <EntityProvider entity={entity}>
            <Routes>
              <Route path={href} element={<Overview />} />
              <Route path={`${href}/grades`} element={<Grades />} />
            </Routes>
          </EntityProvider>
        </TestApiProvider>,
        {
          routeEntries: [href],
          mountedRoutes: { '/catalog/:namespace/:kind/:name': entityRouteRef },
        },
      );

      const withDrop = await screen.findByRole('rowheader', {
        name: 'A with drop',
      });
      const stableA = screen.getByRole('rowheader', { name: 'A' });
      const directOnlyGrade = screen.queryAllByRole('rowheader', { name: 'B' });
      expect(directOnlyGrade).toHaveLength(directOnlyGradeCount);
      for (const grade of [withDrop, stableA, ...directOnlyGrade]) {
        expect(
          within(grade.closest('tr')!).getByRole('gridcell', { name: '1' }),
        ).toBeInTheDocument();
      }
      expect(screen.queryByRole('rowheader', { name: 'D' })).toBeNull();
      expect(
        document.querySelector(`time[datetime="${latest}"]`),
      ).toBeInTheDocument();

      const overviewRepositoryRequests = getEntitiesByRefs.mock.calls
        .map(([request]) => request)
        .filter(request =>
          request.entityRefs.some(ref =>
            ref.startsWith('resource:pyxis/repository-'),
          ),
        );
      expect(overviewRepositoryRequests).toHaveLength(
        name === 'team-1' ? 2 : 1,
      );
      for (const { entityRefs, fields } of overviewRepositoryRequests) {
        expect(entityRefs.length).toBeGreaterThan(100);
        expect(fields).toContain('spec.pyxisChi.snapshot.counts.byGrade');
        expect(fields).not.toContain('spec.pyxisChi');
        expect(fields).not.toContain('spec.pyxisChi.snapshot');
        expect(fields).not.toContain('spec.pyxisChi.snapshot.images');
        expect(fields).not.toContain('spec.pyxisChi.snapshot.streams');
      }
      getEntitiesByRefs.mockClear();

      await user.click(withDrop);
      const section = await screen.findByRole('button', {
        name: 'Grade A with scheduled drop 1 image',
      });
      expect(section).toHaveAttribute('aria-expanded', 'true');
      expect(
        screen.getByRole('button', { name: 'Grade A 1 image' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Grade D/ })).toBeNull();
      expect(
        screen.queryAllByRole('button', { name: 'Grade B 1 image' }),
      ).toHaveLength(directOnlyGradeCount);
      expect(
        screen.getByRole('link', { name: 'portfolio/repository-1' }),
      ).toBeInTheDocument();
      expect(
        document.querySelector(`time[datetime="${latest}"]`),
      ).toBeInTheDocument();
      const detailRequests = getEntitiesByRefs.mock.calls.map(
        ([request]) => request,
      );
      expect(detailRequests).toHaveLength(name === 'team-1' ? 4 : 2);
      for (const { entityRefs, fields } of detailRequests) {
        expect(entityRefs.length).toBeLessThanOrEqual(100);
        expect(fields).toBeUndefined();
      }
      expect(detailRequests.flatMap(({ entityRefs }) => entityRefs)).toEqual(
        overviewRepositoryRequests.flatMap(({ entityRefs }) => entityRefs),
      );
    },
  );

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
