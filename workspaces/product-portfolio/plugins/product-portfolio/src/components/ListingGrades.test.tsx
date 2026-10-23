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
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import {
  fixtureHealth,
  observedAt,
  portfolioFixtures,
} from '../testUtils/fixtures';
import { ListingGrades } from './ListingGrades';

function CurrentLocation() {
  const { pathname, search } = useLocation();
  return <output data-testid="current-location">{pathname + search}</output>;
}

async function renderListingGrades(
  listing: Entity,
  entities: Entity[],
  initialRoute = '/catalog/pyxis/resource/listing-1/grades',
) {
  const entitiesByRef = new Map(
    entities.map(entity => [stringifyEntityRef(entity), entity]),
  );
  const getEntitiesByRefs = jest.fn(
    async ({ entityRefs }: { entityRefs: string[] }) => ({
      items: entityRefs
        .map(ref => entitiesByRef.get(ref))
        .filter((entity): entity is Entity => Boolean(entity)),
    }),
  );

  await renderInTestApp(
    <TestApiProvider apis={[[catalogApiRef, { getEntitiesByRefs }]]}>
      <EntityProvider entity={listing}>
        <ListingGrades />
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

describe('ListingGrades', () => {
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

    const getEntitiesByRefs = await renderListingGrades(listing, entities);

    const gradeA = await screen.findByRole('row', { name: /Grade A/ });
    const gradeB = screen.getByRole('row', { name: /Grade B/ });
    expect(
      screen.queryByRole('row', { name: /Grade C/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'portfolio/repository-1' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Container Health Index')).toBeInTheDocument();
    expect(screen.getByText('Incomplete')).toBeInTheDocument();
    expect(
      screen.getByText(
        'These grade counts are based on incomplete repository observations.',
      ),
    ).toBeInTheDocument();
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
      screen.getByText(
        /latest published CHI candidate selected for a configured/,
      ),
    ).toBeInTheDocument();
    expect(gradeA.querySelector('td')).toHaveStyle({
      backgroundColor: 'var(--bui-bg-success)',
      color: 'var(--bui-fg-success-on-bg)',
    });
    expect(getEntitiesByRefs).toHaveBeenCalledWith({
      entityRefs: expect.arrayContaining([
        'resource:pyxis/repository-1',
        'resource:pyxis/repository-3',
        'resource:pyxis/repository-5',
      ]),
    });

    await user.click(gradeA);

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
    expect(catalogLink.querySelector('svg')).toBeInTheDocument();
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

    await renderListingGrades(
      listing,
      entities,
      '/catalog/pyxis/resource/listing-2/grades?grade=a-with-drop',
    );

    expect(screen.getByTestId('current-location')).toHaveTextContent(
      '/catalog/pyxis/resource/listing-2/grades?grade=a-with-drop',
    );
    const gradeAWithDrop = await screen.findByRole('row', {
      name: /Grade A with scheduled drop/,
    });
    expect(gradeAWithDrop).toBeInTheDocument();
    expect(
      await screen.findByRole('link', {
        name: 'Open portfolio/repository-2 in Red Hat Catalog',
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('row', { name: /^Grade A 1 image$/ }),
    ).not.toBeInTheDocument();
  });
});
