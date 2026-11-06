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
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PYXIS_RELATIONS } from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import { useLocation } from 'react-router-dom';
import {
  fixtureEntity,
  fixtureHealth,
  observedAt,
  portfolioFixtures,
  teamPortfolioFixtures,
} from '../../testUtils/fixtures';
import { Grades } from './Grades';

function CurrentLocation() {
  const { pathname, search } = useLocation();
  return <output data-testid="current-location">{pathname + search}</output>;
}

async function renderGrades(
  entity: Entity,
  entities: Entity[],
  initialRoute = '/catalog/pyxis/resource/listing-1/grades',
) {
  const entitiesByRef = new Map(
    entities.map(candidate => [stringifyEntityRef(candidate), candidate]),
  );
  const getEntitiesByRefs = jest.fn(
    async ({ entityRefs }: { entityRefs: string[] }) => ({
      items: entityRefs
        .map(ref => entitiesByRef.get(ref))
        .filter((candidate): candidate is Entity => Boolean(candidate)),
    }),
  );

  await renderInTestApp(
    <TestApiProvider apis={[[catalogApiRef, { getEntitiesByRefs }]]}>
      <EntityProvider entity={entity}>
        <Grades />
      </EntityProvider>
      <CurrentLocation />
    </TestApiProvider>,
    {
      routeEntries: [initialRoute],
      mountedRoutes: {
        '/catalog/:namespace/:kind/:name': entityRouteRef,
      },
    },
  );

  return getEntitiesByRefs;
}

describe('Grades', () => {
  it('shows only populated grades, starts collapsed, and expands image details', async () => {
    const user = userEvent.setup();
    const entities = portfolioFixtures(13);
    const listing = entities.find(
      entity => entity.metadata.name === 'listing-1',
    )!;
    const repository1 = entities.find(
      entity => entity.metadata.name === 'repository-1',
    )!;
    const repository3 = entities.find(
      entity => entity.metadata.name === 'repository-3',
    )!;
    const pushedAt = '2026-09-01T08:30:00.000Z';
    const repository1Health = fixtureHealth(repository1, 'ready', 'A');
    repository1Health.snapshot!.images[0].activeTags = ['latest', '9.4', '1.2'];
    repository1Health.snapshot!.images[0].pushDates = {
      latest: pushedAt,
      '9.4': '2026-08-30T08:30:00.000Z',
    };
    repository1.spec!.pyxisChi = JSON.parse(JSON.stringify(repository1Health));
    repository3.spec!.pyxisChi = JSON.parse(
      JSON.stringify(fixtureHealth(repository3, 'ready', 'B')),
    );

    const getEntitiesByRefs = await renderGrades(listing, entities);

    const gradeA = await screen.findByRole('button', { name: /Grade A/ });
    const gradeB = screen.getByRole('button', { name: /Grade B/ });
    expect(
      screen.queryByRole('button', { name: /Grade C/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'portfolio/repository-1' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Container Health Index')).toBeInTheDocument();
    expect(screen.getByText('Latest grade observation')).toBeInTheDocument();
    expect(screen.queryByText('Observation status')).not.toBeInTheDocument();
    expect(screen.queryByText('Incomplete')).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        'These grade counts are based on incomplete repository observations.',
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Some related catalog data is unavailable.'),
    ).not.toBeInTheDocument();
    expect(
      document.querySelector(`time[datetime="${observedAt}"]`),
    ).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Name' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Tags' })).toBeNull();
    expect(
      screen.getByText(
        /latest published CHI candidate selected for a configured/,
      ),
    ).toBeInTheDocument();
    expect(gradeA).toHaveStyle({
      backgroundColor: 'var(--bui-bg-success)',
      color: 'var(--bui-fg-success-on-bg)',
    });
    const requestedRefs = getEntitiesByRefs.mock.calls.flatMap(
      ([request]) => request.entityRefs,
    );
    expect(requestedRefs).toEqual(
      expect.arrayContaining([
        'resource:pyxis/repository-1',
        'resource:pyxis/repository-3',
        'resource:pyxis/repository-5',
      ]),
    );

    await user.click(gradeA);

    expect(
      screen.getByRole('columnheader', { name: 'Name' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Tags' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Architecture' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Last pushed' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Next scheduled drop' }),
    ).toBeInTheDocument();

    const repositoryLink = await screen.findByRole('link', {
      name: 'portfolio/repository-1',
    });
    expect(repositoryLink).toHaveAttribute(
      'href',
      '/catalog/pyxis/resource/repository-1',
    );
    const catalogLink = await screen.findByRole('link', {
      name: 'Open portfolio/repository-1 in Red Hat Catalog',
    });
    expect(catalogLink).toHaveAttribute(
      'href',
      'https://catalog.redhat.com/en/software/containers/portfolio/repository-1/000000000000000000000001?tag=latest',
    );
    expect(catalogLink).toHaveAttribute('target', '_blank');
    expect(catalogLink).toHaveAttribute('rel', 'noopener noreferrer');
    expect(catalogLink).toHaveAttribute('title', 'Open in Red Hat Catalog');
    expect(catalogLink).toHaveTextContent('↗');
    expect(screen.getByTestId('current-location')).toHaveTextContent(
      '/catalog/pyxis/resource/listing-1/grades?grade=a',
    );
    expect(screen.getByText('latest')).toBeInTheDocument();
    expect(screen.getByText('9.4')).toBeInTheDocument();
    expect(screen.getByText('1.2')).toBeInTheDocument();
    expect(screen.getByText('amd64')).toBeInTheDocument();
    expect(
      document.querySelector(`time[datetime="${pushedAt}"]`),
    ).toBeInTheDocument();
    expect(
      document.querySelectorAll(`time[datetime="${observedAt}"]`).length,
    ).toBe(1);

    await user.click(gradeB);
    await waitFor(() => {
      expect(screen.getByTestId('current-location')).toHaveTextContent(
        '/catalog/pyxis/resource/listing-1/grades?grade=b',
      );
    });
    expect(
      await screen.findByRole('link', {
        name: 'Open portfolio/repository-3 in Red Hat Catalog',
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', {
        name: 'Open portfolio/repository-1 in Red Hat Catalog',
      }),
    ).not.toBeInTheDocument();
  });

  it('opens a grade from the URL and exposes A with drop as its own section', async () => {
    const entities = portfolioFixtures(13);
    const listing = entities.find(
      entity => entity.metadata.name === 'listing-2',
    )!;

    await renderGrades(
      listing,
      entities,
      '/catalog/pyxis/resource/listing-2/grades?grade=a-with-drop',
    );

    expect(screen.getByTestId('current-location')).toHaveTextContent(
      '/catalog/pyxis/resource/listing-2/grades?grade=a-with-drop',
    );
    const gradeAWithDrop = await screen.findByRole('button', {
      name: /Grade A with scheduled drop/,
    });
    expect(gradeAWithDrop).toBeInTheDocument();
    expect(
      await screen.findByRole('link', {
        name: 'Open portfolio/repository-2 in Red Hat Catalog',
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Grade A 1 image$/ }),
    ).not.toBeInTheDocument();
  });

  it('shows the current repository grades without loading related entities', async () => {
    const user = userEvent.setup();
    const repository = fixtureEntity('repository');
    repository.spec!.pyxisChi = JSON.parse(
      JSON.stringify(fixtureHealth(repository, 'ready', 'A')),
    );

    const getEntitiesByRefs = await renderGrades(
      repository,
      [repository],
      '/catalog/pyxis/resource/repository-1/grades',
    );

    expect(
      await screen.findByRole('button', { name: /Grade A/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('Container Health Index')).toBeInTheDocument();
    expect(screen.getByText('Latest grade observation')).toBeInTheDocument();
    expect(screen.queryByText('Observation status')).not.toBeInTheDocument();
    expect(screen.queryByText('Incomplete')).not.toBeInTheDocument();
    expect(
      document.querySelector(`time[datetime="${observedAt}"]`),
    ).toBeInTheDocument();
    expect(getEntitiesByRefs).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /Grade A/ }));

    expect(
      await screen.findByRole('link', { name: 'portfolio/repository-1' }),
    ).toHaveAttribute('href', '/catalog/pyxis/resource/repository-1');
    expect(screen.getByText('amd64')).toBeInTheDocument();
    expect(screen.getByText('latest')).toBeInTheDocument();
  });

  it('shows grades for direct and listing-linked team repositories without duplicates', async () => {
    const user = userEvent.setup();
    const entities = teamPortfolioFixtures();
    const team = entities.find(entity => entity.metadata.name === 'team-1')!;

    const getEntitiesByRefs = await renderGrades(
      team,
      entities,
      '/catalog/pyxis/group/team-1/grades',
    );

    const gradeA = await screen.findByRole('button', { name: /Grade A/ });
    expect(gradeA).toHaveTextContent('2 images');
    expect(screen.getByRole('button', { name: /Grade B/ })).toHaveTextContent(
      '1 image',
    );
    const requestedRefs = getEntitiesByRefs.mock.calls.flatMap(
      ([request]) => request.entityRefs,
    );
    expect(requestedRefs).toEqual(
      expect.arrayContaining([
        'resource:pyxis/repository-1',
        'resource:pyxis/repository-3',
        'resource:pyxis/repository-5',
      ]),
    );

    await user.click(gradeA);

    expect(
      await screen.findByRole('link', { name: 'portfolio/repository-1' }),
    ).toHaveAttribute('href', '/catalog/pyxis/resource/repository-1');
    expect(
      await screen.findByRole('link', { name: 'portfolio/repository-3' }),
    ).toHaveAttribute('href', '/catalog/pyxis/resource/repository-3');
    expect(
      screen.getAllByRole('link', { name: 'portfolio/repository-3' }),
    ).toHaveLength(1);
  });

  it('searches and paginates expanded grade rows and expands each tag cell', async () => {
    const user = userEvent.setup();
    const entities = portfolioFixtures(60);
    const listing = entities.find(
      entity => entity.metadata.name === 'listing-1',
    )!;
    const repositoryRefs = new Set(
      listing
        .relations!.filter(
          relation => relation.type === PYXIS_RELATIONS.hasRepository,
        )
        .map(relation => relation.targetRef),
    );
    const repositories = entities.filter(entity =>
      repositoryRefs.has(stringifyEntityRef(entity)),
    );

    repositories.forEach((repository, index) => {
      const health = fixtureHealth(repository, 'ready', 'A');
      health.snapshot!.images[0].imageId = `image-${index + 1}`;
      health.snapshot!.images[0].activeTags = [
        'latest',
        '9.4',
        '1.2',
        'extra-4',
        'extra-5',
      ];
      repository.spec!.pyxisChi = JSON.parse(JSON.stringify(health));
    });

    expect(repositories.length).toBeGreaterThan(20);
    await renderGrades(listing, entities);

    const gradeA = await screen.findByRole('button', { name: /Grade A/ });
    expect(screen.queryByRole('columnheader', { name: 'Name' })).toBeNull();

    await user.click(gradeA);

    expect(screen.getAllByRole('columnheader', { name: 'Name' })).toHaveLength(
      1,
    );
    expect(
      screen.getByRole('columnheader', { name: 'Next scheduled drop' }),
    ).toBeInTheDocument();
    const firstPageRowCount = screen.getAllByRole('link', {
      name: /^portfolio\/repository-/,
    }).length;

    const searchField = screen.getByRole('searchbox', {
      name: 'Search grade A images by repository name',
    });
    await user.type(searchField, 'REPOSITORY-1');
    expect(
      await screen.findByRole('link', { name: 'portfolio/repository-1' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'portfolio/repository-3' }),
    ).not.toBeInTheDocument();

    await user.clear(searchField);
    await waitFor(() => {
      expect(
        screen.getAllByRole('link', { name: /^portfolio\/repository-/ }),
      ).toHaveLength(firstPageRowCount);
    });

    const firstRepositoryLink = screen.getAllByRole('link', {
      name: /^portfolio\/repository-/,
    })[0];
    const firstRow = firstRepositoryLink.closest('tr');
    expect(firstRow).not.toBeNull();
    const firstRowWithin = within(firstRow!);
    expect(firstRowWithin.getByText('latest')).toBeInTheDocument();
    expect(firstRowWithin.queryByText('extra-4')).toBeNull();
    await user.click(firstRowWithin.getByRole('button', { name: '+2 more' }));
    expect(firstRowWithin.getByText('extra-4')).toBeInTheDocument();
    expect(
      firstRowWithin.getByRole('button', { name: 'Show fewer tags' }),
    ).toHaveAttribute('aria-expanded', 'true');

    await user.click(screen.getByRole('button', { name: 'Next table page' }));
    expect(
      screen.getAllByRole('link', { name: /^portfolio\/repository-/ }),
    ).toHaveLength(
      Math.min(firstPageRowCount, repositories.length - firstPageRowCount),
    );

    await user.click(gradeA);
    expect(screen.queryByRole('columnheader', { name: 'Name' })).toBeNull();
  });
});
