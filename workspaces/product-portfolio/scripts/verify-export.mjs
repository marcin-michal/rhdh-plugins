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
import assert from 'node:assert/strict';
import {
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const moduleDirectory = resolve('plugins/catalog-backend-module-pyxis');
export const exportDirectory = join(moduleDirectory, 'dist-dynamic');
export function verifyExport() {
  const stamp = JSON.parse(
    readFileSync('release-evidence/export-source-state.json', 'utf8'),
  );
  assert.equal(stamp.sourceHash, sourceState(), 'Dynamic export is stale');
  const pkg = JSON.parse(
    readFileSync(join(exportDirectory, 'package.json'), 'utf8'),
  );
  assert.equal(pkg.backstage.role, 'backend-plugin-module');
  assert.equal(pkg.backstage.pluginId, 'catalog');
  assert(
    !pkg.devDependencies || !Object.keys(pkg.devDependencies).length,
    'Export contains development dependencies',
  );
  const dependencies = { ...pkg.dependencies, ...pkg.peerDependencies };
  assert(
    Object.values(dependencies).every(value => !value.startsWith('workspace:')),
    'Workspace references escaped export',
  );
  for (const library of [
    'product-portfolio-common',
    'pyxis-common',
    'pyxis-node',
  ])
    assert(
      !Object.hasOwn(
        dependencies,
        `@red-hat-developer-hub/backstage-plugin-${library}`,
      ),
      `Library not embedded: ${library}`,
    );
  assert(pkg.configSchema, 'Missing generated configuration schema');
  if (typeof pkg.configSchema === 'string')
    assert(
      existsSync(join(exportDirectory, pkg.configSchema)),
      'Missing config schema file',
    );
  const walk = directory =>
    readdirSync(directory).flatMap(name => {
      const filename = join(directory, name);
      return statSync(filename).isDirectory() ? walk(filename) : [filename];
    });
  const files = walk(exportDirectory).map(filename =>
    filename.slice(exportDirectory.length + 1),
  );
  assert(
    files.every(
      filename =>
        !/(^|\/)(fixtures|test|tests|__tests__)(\/|$)|\.(key|pem|crt)$|credentials|\.test\./.test(
          filename,
        ),
    ),
    'Fixtures, test material or secrets in exported package',
  );
  const require = createRequire(join(exportDirectory, 'package.json'));
  const feature = require(resolve(exportDirectory, pkg.main)).default;
  assert.equal(
    feature?.$$type,
    '@backstage/BackendFeature',
    'Missing default backend feature',
  );
  const inventory = {
    sourceHash: sourceState(),
    name: pkg.name,
    version: pkg.version,
    packageDirectory: exportDirectory,
    entrypoint: pkg.main,
    configSchema: pkg.configSchema,
    dependencies: pkg.dependencies ?? {},
    sharedDependencies: pkg.peerDependencies ?? {},
    files,
    exporterVersion: '1.10.8',
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    sourceDirty: !!execFileSync('git', ['status', '--porcelain', '.'], {
      encoding: 'utf8',
    }).trim(),
    lockfileHash: createHash('sha256')
      .update(readFileSync('yarn.lock'))
      .digest('hex'),
  };
  mkdirSync('release-evidence', { recursive: true });
  writeFileSync(
    'release-evidence/export-inventory.json',
    JSON.stringify(inventory, null, 2),
  );
  return inventory;
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  verifyExport();
  console.log('Dynamic export verified');
}
