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

import { startTestBackend, mockServices } from '@backstage/backend-test-utils';
import { authServiceFactory } from '@backstage/backend-defaults/auth';
import { httpAuthServiceFactory } from '@backstage/backend-defaults/httpAuth';
import { httpRouterServiceFactory } from '@backstage/backend-defaults/httpRouter';
import { backendFeatures } from './features';
import type { AddressInfo } from 'node:net';

describe('local catalog authentication', () => {
  it('rejects anonymous catalog reads and accepts a token from development guest sign-in', async () => {
    const env = jest.replaceProperty(process, 'env', {
      ...process.env,
      NODE_ENV: 'development',
    });
    try {
      const { server } = await startTestBackend({
        features: [
          ...backendFeatures,
          authServiceFactory,
          httpAuthServiceFactory,
          httpRouterServiceFactory,
          mockServices.rootConfig.factory({
            data: {
              app: { baseUrl: 'http://localhost:3000' },
              backend: {
                baseUrl: 'http://localhost:7007',
                auth: { dangerouslyDisableDefaultAuthPolicy: false },
              },
              auth: { environment: 'development', providers: { guest: {} } },
            },
          }),
        ],
      });
      const baseUrl = `http://localhost:${
        (server.address() as AddressInfo).port
      }`;
      const anonymous = await fetch(`${baseUrl}/api/catalog/entities`);
      expect(anonymous.status).toBe(401);
      const signIn = await fetch(`${baseUrl}/api/auth/guest/refresh`, {
        headers: { 'x-requested-with': 'XMLHttpRequest' },
      });
      expect(signIn.status).toBe(200);
      const { backstageIdentity } = await signIn.json();
      expect(backstageIdentity.token).toEqual(expect.any(String));
      const catalog = await fetch(`${baseUrl}/api/catalog/entities`, {
        headers: { authorization: `Bearer ${backstageIdentity.token}` },
      });
      expect(catalog.status).toBe(200);
      expect(await catalog.json()).toEqual([]);
    } finally {
      env.restore();
    }
  }, 30000);
});
