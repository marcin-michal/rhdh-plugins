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

import assert from 'node:assert/strict';
import {
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { sourceState } from './source-state.mjs';
export const frontendDirectory = resolve('plugins/product-portfolio');
const exported = join(frontendDirectory, 'dist-dynamic');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const hash = path =>
  createHash('sha256').update(readFileSync(path)).digest('hex');
const classicComponents = [
  'ProductPortfolioPageExtension',
  'ProductPortfolioListingOverview',
  'ProductPortfolioListingRepositories',
  'ProductPortfolioRepositoryOverview',
  'ProductPortfolioRepositoryProductListings',
  'ProductPortfolioTeamOverview',
  'ProductPortfolioTeamRepositories',
  'ProductPortfolioTeamProductListings',
  'ProductPortfolioGrades',
];
export function verifyFrontendExport() {
  assert.equal(
    read('release-evidence/frontend-export-source-state.json').sourceHash,
    sourceState(),
    'Frontend export is stale',
  );
  const pkg = read(join(exported, 'package.json'));
  assert.equal(pkg.backstage.role, 'frontend-plugin');
  assert.equal(pkg.backstage.pluginId, 'product-portfolio');
  assert.equal(pkg.backstage['supported-versions'], '1.49.4');
  assert.equal(
    pkg.scalprum?.name,
    'red-hat-developer-hub.backstage-plugin-product-portfolio',
    'Missing classic Scalprum package name',
  );
  assert.equal(
    pkg.scalprum?.exposedModules?.PluginRoot,
    './src/index.ts',
    'Missing classic PluginRoot entry point',
  );
  assert.equal(
    Object.keys(pkg.devDependencies ?? {}).length,
    0,
    'Development dependencies escaped export',
  );
  assert(
    !JSON.stringify(pkg).includes('workspace:'),
    'Workspace reference escaped export',
  );
  assert(
    !existsSync(join(exported, 'node_modules')),
    'Frontend must not install a second runtime',
  );
  assert.equal(
    hash(join(exported, 'app-config.yaml')),
    hash(join(frontendDirectory, 'app-config.yaml')),
    'Missing or altered installation fragment',
  );
  assert.equal(
    hash(join(exported, 'app-config.legacy.yaml')),
    hash(join(frontendDirectory, 'app-config.legacy.yaml')),
    'Missing or altered classic installation fragment',
  );
  const walk = directory =>
    readdirSync(directory)
      .sort()
      .flatMap(name => {
        const file = join(directory, name);
        return statSync(file).isDirectory() ? walk(file) : [file];
      });
  const files = walk(exported);
  const scalprum = read(join(exported, 'dist-scalprum/plugin-manifest.json'));
  assert.equal(scalprum.name, pkg.scalprum.name);
  assert(scalprum.loadScripts.length > 0, 'Missing classic entry script');
  for (const script of scalprum.loadScripts)
    assert(
      existsSync(join(exported, 'dist-scalprum', script)),
      'Missing classic entry script: ' + script,
    );
  const classicConfig = readFileSync(
    join(exported, 'app-config.legacy.yaml'),
    'utf8',
  );
  assert(
    classicConfig.includes(pkg.scalprum.name),
    'Classic config refers to a different Scalprum package',
  );
  const rootSource = readFileSync(
    join(frontendDirectory, 'src/index.ts'),
    'utf8',
  );
  for (const name of ['ProductPortfolioIcon', ...classicComponents]) {
    assert(rootSource.includes(name), 'Missing classic module export: ' + name);
    assert(
      classicConfig.includes(`importName: ${name}`),
      'Missing classic config mount: ' + name,
    );
  }
  for (const condition of [
    'isPyxisListing',
    'isPyxisRepository',
    'isPyxisTeam',
    'isPyxisPortfolioEntity',
  ]) {
    assert(
      rootSource.includes(condition),
      'Missing classic condition export: ' + condition,
    );
    assert(
      classicConfig.includes(`- ${condition}`),
      'Missing classic config condition: ' + condition,
    );
  }
  for (const file of files)
    assert(
      !/(^|\/)(fixtures|testUtils|tests|__tests__|packages)(\/|$)|\.test\.|\.(key|pem|crt)$/.test(
        file.slice(exported.length),
      ),
      'Forbidden export file: ' + file,
    );
  const mf = read(join(exported, 'dist/mf-manifest.json'));
  assert(
    mf.exposes.some(e => e.path === './alpha'),
    'Missing alpha federation exposure',
  );
  assert(
    existsSync(
      join(
        exported,
        'dist',
        mf.metaData.remoteEntry.path,
        mf.metaData.remoteEntry.name,
      ),
    ),
    'Missing remote entry',
  );
  for (const name of ['react', 'react-dom', 'react-router-dom'])
    assert(
      mf.shared.some(s => s.name === name && s.singleton),
      'Non-singleton host runtime: ' + name,
    );
  const sources = files
    .filter(p => p.endsWith('.map'))
    .flatMap(p => read(p).sources ?? []);
  for (const source of sources)
    assert(
      !/pyxis-node|catalog-backend|backend-plugin-api|\/testUtils\/|\/fixtures\/|\.test\./.test(
        source,
      ),
      'Forbidden browser module: ' + source,
    );
  assert(
    sources.some(s => s.includes('/pyxis-common/src/projectionParsers.ts')),
    'Shared runtime guards were not bundled',
  );
  const nfs = read('release-evidence/frontend-nfs-tests.json');
  assert.equal(nfs.success, true);
  assert(nfs.numPassedTests >= 3, 'Missing NFS feature evidence');
  const classic = read('release-evidence/frontend-legacy-tests.json');
  assert.equal(classic.success, true);
  assert(classic.numPassedTests >= 2, 'Missing classic adapter evidence');
  const inventory = {
    sourceHash: sourceState(),
    name: pkg.name,
    version: pkg.version,
    packageDirectory: exported,
    entrypoint: 'dist/mf-manifest.json',
    feature: '@backstage/FrontendPlugin',
    featureEvidence: 'frontend-nfs-tests.json',
    classicEntrypoint: pkg.scalprum.exposedModules.PluginRoot,
    classicConfig: 'app-config.legacy.yaml',
    classicEvidence: 'frontend-legacy-tests.json',
    extensions: [
      'page:product-portfolio',
      'entity-content:product-portfolio/listing-overview',
      'entity-content:product-portfolio/repository-overview',
      'entity-content:product-portfolio/repository-product-listings',
      'entity-content:product-portfolio/listing-repositories',
      'entity-content:product-portfolio/listing-grades',
      'entity-content:product-portfolio/repository-grades',
      'entity-content:product-portfolio/team-overview',
      'entity-content:product-portfolio/team-repositories',
      'entity-content:product-portfolio/team-product-listings',
      'entity-content:product-portfolio/team-grades',
    ],
    classicComponents,
    classicEntityTabs: [
      '/product-portfolio',
      '/product-portfolio/repositories',
      '/product-portfolio/product-listings',
      '/product-portfolio/grades',
    ],
    routes: ['/product-portfolio', '/'],
    sharedDependencies: mf.shared.map(({ name, version, singleton }) => ({
      name,
      version,
      singleton,
    })),
    localLibraries: {
      'pyxis-common': 'bundled runtime and erased types',
      'product-portfolio-common': 'type-only; erased at compilation',
    },
    files: files.map(file => ({
      path: file.slice(exported.length + 1),
      mode: statSync(file).mode & 0o777,
      size: statSync(file).size,
      sha256: hash(file),
    })),
    nodeVersion: process.version,
    yarnVersion: execFileSync('yarn', ['--version'], {
      encoding: 'utf8',
    }).trim(),
    exporterVersion: '1.10.8',
    backstageVersion: '1.49.4',
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    sourceDirty: !!execFileSync('git', ['status', '--porcelain', '.'], {
      encoding: 'utf8',
    }).trim(),
    lockfileHash: hash('yarn.lock'),
  };
  writeFileSync(
    'release-evidence/frontend-export-inventory.json',
    JSON.stringify(inventory, null, 2),
  );
  return inventory;
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  verifyFrontendExport();
  console.log('Frontend dynamic export verified');
}
