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

import { useEffect } from 'react';
import {
  ApiBlueprint,
  AppRootElementBlueprint,
  createFrontendModule,
} from '@backstage/frontend-plugin-api';
import {
  SignInPageBlueprint,
  type SignInPageProps,
} from '@backstage/plugin-app-react';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { fixtureCatalog } from './catalog';

function FixtureSignIn({ onSignInSuccess }: SignInPageProps) {
  useEffect(() => {
    onSignInSuccess({
      getProfileInfo: async () => ({ displayName: 'Fixture user' }),
      getBackstageIdentity: async () => ({
        type: 'user',
        userEntityRef: 'user:default/fixture',
        ownershipEntityRefs: [],
      }),
      getCredentials: async () => ({}),
      signOut: async () => {},
    });
  }, [onSignInSuccess]);
  return null;
}
export const fixtures = createFrontendModule({
  pluginId: 'catalog',
  extensions: [
    ApiBlueprint.make({
      params: defineParams =>
        defineParams({
          api: catalogApiRef,
          deps: {},
          factory: () => fixtureCatalog(),
        }),
    }),
  ],
});
export const signIn = createFrontendModule({
  pluginId: 'app',
  extensions: [
    AppRootElementBlueprint.make({
      name: 'demo-notice',
      params: {
        element: (
          <aside
            role="status"
            aria-label="Demo mode"
            style={{
              position: 'fixed',
              bottom: 16,
              right: 16,
              zIndex: 1400,
              padding: '12px 20px',
              borderRadius: 8,
              background: '#fff4ce',
              color: '#332500',
              boxShadow: '0 2px 12px #0003',
              fontSize: 14,
            }}
          >
            Demo mode — synthetic catalog data. Restart with yarn start for live
            data.
          </aside>
        ),
      },
    }),
    SignInPageBlueprint.make({ params: { loader: async () => FixtureSignIn } }),
  ],
});
