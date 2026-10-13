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
import { resolve, join, relative, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const moduleDirectory = resolve('plugins/catalog-backend-module-pyxis');
export const exportDirectory = join(moduleDirectory, 'dist-dynamic');
const embeddedLibraries = [
  '@red-hat-developer-hub/backstage-plugin-product-portfolio-common',
  '@red-hat-developer-hub/backstage-plugin-pyxis-common',
  '@red-hat-developer-hub/backstage-plugin-pyxis-node',
];

function assertInsideExport(filename, description) {
  const pathFromExport = relative(exportDirectory, filename);
  assert(
    pathFromExport &&
      !isAbsolute(pathFromExport) &&
      pathFromExport !== '..' &&
      !pathFromExport.startsWith(`..${sep}`),
    `${description} resolves outside the export`,
  );
  assert(existsSync(filename), `${description} is missing`);
}

function readPackage(directory) {
  return JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
}

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
  const lockfile = readFileSync(join(exportDirectory, 'yarn.lock'), 'utf8');
  const packageMap = JSON.parse(
    readFileSync(
      join(exportDirectory, 'node_modules/.package-map.json'),
      'utf8',
    ),
  ).packages;
  const embeddedDirectory = join(exportDirectory, 'embedded');
  const embeddedPackages = readdirSync(embeddedDirectory).map(directory => {
    const path = join(embeddedDirectory, directory);
    return { directory, path, manifest: readPackage(path) };
  });

  for (const match of lockfile.matchAll(/file:(\.\.?\/[^:#\s"]+)/g)) {
    const target = resolve(exportDirectory, match[1]);
    assertInsideExport(target, `Local dependency ${match[1]}`);
  }

  for (const library of embeddedLibraries) {
    assert(Object.hasOwn(dependencies, library), `Missing library: ${library}`);
    assert(
      !lockfile.includes(`"${library}@npm:`),
      `Private library resolves from npm: ${library}`,
    );

    const embedded = embeddedPackages.filter(
      candidate => candidate.manifest.name === library,
    );
    assert.equal(
      embedded.length,
      1,
      `Library not embedded exactly once: ${library}`,
    );
    const [bundle] = embedded;
    const localLocator = `${library}@file:./embedded/${bundle.directory}`;
    assert(
      lockfile.includes(localLocator),
      `Library has no local lockfile resolution: ${library}`,
    );

    const runtimeMapping = packageMap[library];
    assert(
      runtimeMapping,
      `Library has no runtime package mapping: ${library}`,
    );
    assert.equal(
      packageMap['.']?.dependencies?.[library],
      library,
      `Root runtime mapping is missing: ${library}`,
    );
    const runtimeDirectory = resolve(
      exportDirectory,
      'node_modules',
      runtimeMapping.url,
    );
    assertInsideExport(runtimeDirectory, `Runtime library ${library}`);
    const runtimePackage = readPackage(runtimeDirectory);
    assert.equal(runtimePackage.name, library);
    assert.equal(runtimePackage.version, bundle.manifest.version);
    assert.match(runtimePackage.version, /\+embedded$/);

    for (const [description, directory, manifest] of [
      ['Embedded', bundle.path, bundle.manifest],
      ['Runtime', runtimeDirectory, runtimePackage],
    ]) {
      assert(
        manifest.main,
        `${description} library has no main file: ${library}`,
      );
      assertInsideExport(
        resolve(directory, manifest.main),
        `${description} library entrypoint ${library}`,
      );
    }
    assert.equal(
      createHash('sha256')
        .update(readFileSync(resolve(bundle.path, bundle.manifest.main)))
        .digest('hex'),
      createHash('sha256')
        .update(readFileSync(resolve(runtimeDirectory, runtimePackage.main)))
        .digest('hex'),
      `Runtime library differs from embedded bundle: ${library}`,
    );
  }

  const backstageRuntimeDirectory = join(
    exportDirectory,
    'node_modules/@backstage',
  );
  assert(
    !existsSync(backstageRuntimeDirectory) ||
      readdirSync(backstageRuntimeDirectory).length === 0,
    'Export contains duplicated Backstage framework packages',
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
