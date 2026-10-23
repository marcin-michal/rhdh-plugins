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
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
} from 'node:fs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const sourceHash = sourceState();
const target = process.argv[2] ?? 'backend';
assert(
  ['backend', 'frontend'].includes(target),
  'Expected backend or frontend',
);
const frontend = target === 'frontend';
const directory = resolve(
  frontend
    ? 'plugins/product-portfolio'
    : 'plugins/catalog-backend-module-pyxis',
);
const cli = resolve('node_modules/@red-hat-developer-hub/cli/bin/rhdh-cli');
assert.equal(
  JSON.parse(
    readFileSync(
      resolve('node_modules/@red-hat-developer-hub/cli/package.json'),
    ),
  ).version,
  '1.10.8',
);
const result = spawnSync(
  process.execPath,
  [
    cli,
    'plugin',
    'export',
    '--clean',
    ...(frontend
      ? ['--no-generate-scalprum-assets']
      : [
          '--embed-package',
          '@red-hat-developer-hub/backstage-plugin-product-portfolio-common',
          '@red-hat-developer-hub/backstage-plugin-pyxis-common',
          '@red-hat-developer-hub/backstage-plugin-pyxis-node',
        ]),
  ],
  { cwd: directory, stdio: 'inherit' },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const zodSourceDirectory = resolve(
  'plugins/catalog-backend-module-pyxis/dist-dynamic/node_modules/zod/src',
);
if (!frontend)
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

if (frontend) {
  // The pinned frontend exporter bundles local runtime code; type-only common
  // contracts erase at compilation. Never leave private npm install edges.
  const manifestPath = resolve(directory, 'dist-dynamic/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath));
  for (const field of ['dependencies', 'resolutions']) {
    for (const name of [
      '@red-hat-developer-hub/backstage-plugin-product-portfolio-common',
      '@red-hat-developer-hub/backstage-plugin-pyxis-common',
    ])
      delete manifest[field]?.[name];
  }
  delete manifest.jest;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  copyFileSync(
    resolve(directory, 'app-config.yaml'),
    resolve(directory, 'dist-dynamic/app-config.yaml'),
  );
  mkdirSync('release-evidence', { recursive: true });
  const tests = spawnSync(
    'yarn',
    [
      'workspace',
      '@red-hat-developer-hub/backstage-plugin-product-portfolio',
      'test',
      '--runInBand',
      '--watch=false',
      '--testPathPatterns=alpha.test.tsx',
      '--testNamePattern=exports exactly|binds the dedicated|mounts the lazy',
      '--json',
      `--outputFile=${resolve('release-evidence/frontend-nfs-tests.json')}`,
    ],
    { stdio: 'inherit' },
  );
  assert.equal(tests.status, 0, 'Default NFS feature and route tests failed');
}
assert.equal(sourceState(), sourceHash, 'Source changed during export');

mkdirSync('release-evidence', { recursive: true });
writeFileSync(
  `release-evidence/${frontend ? 'frontend-' : ''}export-source-state.json`,
  JSON.stringify({ sourceHash }),
);
