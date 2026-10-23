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

import { createApp } from '@backstage/frontend-defaults';
import catalog from '@backstage/plugin-catalog/alpha';
import portfolio from '@red-hat-developer-hub/backstage-plugin-product-portfolio/alpha';
import { developmentFeatures } from './developmentFeatures';

// The built-in Catalog API and guest sign-in use the configured backend.
// Only the explicit demo configuration replaces them with in-memory fixtures.
export default createApp({
  features: [catalog, portfolio, developmentFeatures],
});
