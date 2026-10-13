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

import { sourceState } from './source-state.mjs';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const sourceHash = sourceState();
const result = spawnSync(
  'yarn',
  [
    'rhdh-cli',
    'plugin',
    'export',
    '--clean',
    '--embed-package',
    '@red-hat-developer-hub/backstage-plugin-product-portfolio-common',
    '@red-hat-developer-hub/backstage-plugin-pyxis-common',
    '@red-hat-developer-hub/backstage-plugin-pyxis-node',
  ],
  { cwd: resolve('plugins/catalog-backend-module-pyxis'), stdio: 'inherit' },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const zodSourceDirectory = resolve(
  'plugins/catalog-backend-module-pyxis/dist-dynamic/node_modules/zod/src',
);
for (const testDirectory of [
  'v3/tests',
  'v4/classic/tests',
  'v4/core/tests',
  'v4/mini/tests',
]) {
  rmSync(resolve(zodSourceDirectory, testDirectory), {
    recursive: true,
    force: true,
  });
}

assert.equal(sourceState(), sourceHash, 'Source changed during export');

mkdirSync('release-evidence', { recursive: true });
writeFileSync(
  'release-evidence/export-source-state.json',
  JSON.stringify({ sourceHash }),
);
