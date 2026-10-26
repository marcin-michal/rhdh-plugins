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

import type { Entity } from '@backstage/catalog-model';
import {
  catalogApiRef,
  EntityProvider,
  entityRouteRef,
} from '@backstage/plugin-catalog-react';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import type {
  PyxisProjection,
  SourceRepository,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import {
  fixtureEntity,
  fixtureHealth,
  observedAt,
} from '../../testUtils/fixtures';
import { RepositoryOverview } from './Overview';

function CurrentLocation() {
  const { pathname, search } = useLocation();
  return <output data-testid="current-location">{pathname + search}</output>;
}

function repositoryWithDetails(
  overrides: Partial<SourceRepository> = {},
): Entity {
  const entity = fixtureEntity('repository');
  const projection = entity.spec!.pyxis as unknown as PyxisProjection;
  const record = projection.record as SourceRepository;

  projection.record = {
    ...record,
    display_data: {
      name: 'PostgreSQL 15',
      short_description: 'PostgreSQL container image',
      long_description: 'Long description for PostgreSQL 15.',
    },
    registry: 'registry.redhat.io',
    repository: 'rhel9/postgresql-15',
    team_id: 'team-postgresql',
    published: true,
    release_categories: ['Generally Available', 'Beta'],
    architectures: ['amd64', 's390x'],
    contacts: [
      { email_address: 'maintainers@example.com', type: 'Image Owner' },
    ],
    documentation_links: [
      {
        title: 'PostgreSQL user guide',
        type: 'Documentation',
        url: 'https://docs.example.com/postgresql',
      },
    ],
    metrics: { pulls_in_last_30_days: 1234, last_update_date: observedAt },
    creation_date: observedAt,
    last_update_date: observedAt,
    ...overrides,
  };
  entity.spec!.pyxisChi = JSON.parse(JSON.stringify(fixtureHealth(entity)));

  return entity;
}

async function renderRepositoryOverview(entity: Entity) {
  const getEntitiesByRefs = jest.fn(
    async (_options: { entityRefs: string[] }) => ({ items: [] as Entity[] }),
  );

  return renderInTestApp(
    <TestApiProvider apis={[[catalogApiRef, { getEntitiesByRefs }]]}>
      <EntityProvider entity={entity}>
        <RepositoryOverview />
      </EntityProvider>
      <CurrentLocation />
    </TestApiProvider>,
    {
      routeEntries: ['/catalog/pyxis/resource/repository-1'],
      mountedRoutes: {
        '/catalog/:namespace/:kind/:name': entityRouteRef,
      },
    },
  );
}

describe('RepositoryOverview', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse(observedAt) + 1000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders repository information and grades for this repository', async () => {
    const repository = repositoryWithDetails();

    await renderRepositoryOverview(repository);

    expect(
      screen.getByText('Long description for PostgreSQL 15.'),
    ).toBeInTheDocument();
    expect(screen.getByText('rhel9/postgresql-15')).toBeInTheDocument();
    expect(screen.getByText('registry.redhat.io')).toBeInTheDocument();
    expect(screen.getByText('Published')).toBeInTheDocument();
    expect(screen.getByText('Pyxis ID')).toBeInTheDocument();
    expect(
      screen.getByText(
        (repository.spec!.pyxis as unknown as PyxisProjection).source.id,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Team', { exact: true })).toBeInTheDocument();
    expect(await screen.findByText('team-postgresql')).toBeInTheDocument();
    expect(
      screen.getByText('Generally Available', { exact: true }),
    ).toBeInTheDocument();
    expect(screen.getByText('Beta', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('amd64', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('s390x', { exact: true })).toBeInTheDocument();

    expect(
      screen.getByRole('link', { name: 'maintainers@example.com' }),
    ).toHaveAttribute('href', 'mailto:maintainers@example.com');
    expect(
      screen.getByRole('link', { name: 'PostgreSQL user guide' }),
    ).toHaveAttribute('href', 'https://docs.example.com/postgresql');
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dates' })).toBeInTheDocument();
    expect(
      document.querySelector(`time[datetime="${observedAt}"]`),
    ).toBeInTheDocument();

    expect(screen.getByRole('rowheader', { name: 'A' })).toBeInTheDocument();
    expect(screen.getByRole('gridcell', { name: '1' })).toBeInTheDocument();
    expect(
      screen.queryByRole('rowheader', { name: 'B' }),
    ).not.toBeInTheDocument();
  });

  it('opens the matching grade section on the Grades tab from a grade row', async () => {
    const user = userEvent.setup();
    const repository = repositoryWithDetails();

    await renderRepositoryOverview(repository);

    await user.click(await screen.findByRole('rowheader', { name: 'A' }));

    await waitFor(() => {
      expect(screen.getByTestId('current-location')).toHaveTextContent(
        '/catalog/pyxis/resource/repository-1/grades?grade=a',
      );
    });
  });

  it('uses the URL when a documentation link has no useful title or type', async () => {
    const url = 'https://docs.example.com/unknown-title';
    const repository = repositoryWithDetails({
      documentation_links: [{ title: 'UNKNOWN', type: 'Documentation', url }],
    });

    await renderRepositoryOverview(repository);

    expect(screen.getByRole('link', { name: url })).toHaveAttribute(
      'href',
      url,
    );
    expect(
      screen.queryByText('UNKNOWN', { exact: true }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Documentation', { exact: true }),
    ).not.toBeInTheDocument();
  });

  it('shows empty and unavailable values when Pyxis has no optional details', async () => {
    const repository = repositoryWithDetails({
      display_data: null,
      registry: null,
      repository: null,
      published: null,
      release_categories: null,
      architectures: null,
      contacts: [],
      documentation_links: [],
      metrics: null,
      creation_date: null,
      last_update_date: null,
    });
    delete repository.metadata.description;

    await renderRepositoryOverview(repository);

    expect(
      screen.getByText('No long description is available.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(
      screen.getByText('No contacts are listed for this repository.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('No documentation links are available.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'A' })).toBeInTheDocument();
  });

  it('reports a category mismatch for entities that are not repositories', async () => {
    await renderInTestApp(
      <EntityProvider entity={fixtureEntity('listing')}>
        <RepositoryOverview />
      </EntityProvider>,
    );

    expect(
      screen.getByText('Managed entity category mismatch.'),
    ).toBeInTheDocument();
  });
});
