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

import '@testing-library/jest-dom';
import { renderTestApp } from '@backstage/frontend-test-utils';
import { MockConfigApi } from '@backstage/test-utils';
import { discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { createApp } from '@backstage/frontend-defaults';
import { render as renderRoot, screen, waitFor } from '@testing-library/react';
import catalog from '@backstage/plugin-catalog/alpha';
import portfolio from '@red-hat-developer-hub/backstage-plugin-product-portfolio/alpha';
import { loadDevelopmentFeatures } from './developmentFeatures';

const backendUrl = 'http://localhost:7007/api/catalog';

function render(
  features: Awaited<ReturnType<typeof loadDevelopmentFeatures>>,
  fetch: jest.Mock,
) {
  return renderTestApp({
    features: [catalog, portfolio, ...features],
    initialRouteEntries: ['/product-portfolio'],
    apis: [
      [discoveryApiRef, { getBaseUrl: async () => backendUrl }],
      [fetchApiRef, { fetch }],
    ],
  });
}

describe('development catalog modes', () => {
  it.each([undefined, false])(
    'queries the backend catalog when demo is %s',
    async demo => {
      const fetch = jest.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => [],
          } as unknown as Response),
      );
      const features = await loadDevelopmentFeatures(
        new MockConfigApi({ productPortfolio: { demo } }),
      );
      render(features, fetch);
      await screen.findByText('No matching portfolio entities.');
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining(`${backendUrl}/entities?`),
        expect.anything(),
      );
      expect(screen.queryByLabelText('Demo mode')).not.toBeInTheDocument();
      expect(screen.queryByText('Listing 1')).not.toBeInTheDocument();
    },
  );

  it('shows backend failures without silently replacing real data with fixtures', async () => {
    const fetch = jest.fn(async () => {
      throw new Error('Catalog backend is unreachable');
    });
    render(await loadDevelopmentFeatures(new MockConfigApi({})), fetch);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await screen.findByRole('alert');
    expect(screen.queryByText('Listing 1')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Demo mode')).not.toBeInTheDocument();
  });

  it('loads synthetic data only in explicit demo mode and labels it', async () => {
    const fetch = jest.fn(async () => {
      throw new Error('Demo must not contact a backend');
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetch;
    window.history.replaceState(null, '', '/product-portfolio');
    try {
      const features = await loadDevelopmentFeatures(
        new MockConfigApi({ productPortfolio: { demo: true } }),
      );
      const app = createApp({
        features: [catalog, portfolio, ...features],
        advanced: {
          configLoader: async () => ({
            config: new MockConfigApi({
              app: { baseUrl: 'http://localhost:3000' },
              backend: { baseUrl: 'http://localhost:7007' },
            }),
          }),
        },
      });
      renderRoot(app.createRoot());
      await screen.findByRole('heading', { name: 'Product Portfolio (32)' });
      expect(screen.getByLabelText('Demo mode')).toHaveTextContent(
        'synthetic catalog data',
      );
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
      window.history.replaceState(null, '', '/');
    }
  });
});
