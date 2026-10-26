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

import { catalogApiRef, entityRouteRef } from '@backstage/plugin-catalog-react';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { portfolioFixtures } from '../testUtils/fixtures';
import { ProductPortfolioPage } from './ProductPortfolioPage';

describe('ProductPortfolioPage', () => {
  it('shows one table for the selected kind and has no all-entries option', async () => {
    const user = userEvent.setup();
    const entities = portfolioFixtures(13).filter(
      entity => entity.metadata.namespace === 'pyxis',
    );
    const getEntities = jest.fn(async () => ({ items: entities }));

    await renderInTestApp(
      <TestApiProvider apis={[[catalogApiRef, { getEntities }]]}>
        <ProductPortfolioPage />
      </TestApiProvider>,
      {
        mountedRoutes: {
          '/catalog/:namespace/:kind/:name': entityRouteRef,
        },
      },
    );

    expect(
      screen.queryByRole('radio', { name: /All entries/ }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole('columnheader', { name: 'Short description' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('row', { name: /Listing 1/ }),
    ).toHaveTextContent('Short description for listing 1');
    expect(screen.getByRole('link', { name: 'team 1' })).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Repositories/ }));

    expect(
      await screen.findByRole('columnheader', {
        name: 'Registry / repository',
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('columnheader', { name: 'Short description' }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole('row', { name: /Repository 1/ }),
    ).toHaveTextContent('registry.redhat.io/portfolio/repository-1');

    await user.click(screen.getByRole('radio', { name: /Teams/ }));

    expect(
      await screen.findByRole('columnheader', { name: 'Members' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('columnheader', { name: 'Registry / repository' }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole('row', { name: /Team 1/ }),
    ).toHaveTextContent('2');
    expect(getEntities).toHaveBeenCalled();
  });
});
