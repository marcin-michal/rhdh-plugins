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

import auth from '@backstage/plugin-auth-backend';
import guest from '@backstage/plugin-auth-backend-module-guest-provider';
import catalog from '@backstage/plugin-catalog-backend';
import pyxis from '@red-hat-developer-hub/backstage-plugin-catalog-backend-module-pyxis';

// Shared by the development backend and its authentication integration test.
export const backendFeatures = [auth, guest, catalog, pyxis];
