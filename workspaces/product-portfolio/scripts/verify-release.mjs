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
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { verifyFrontendExport } from './verify-frontend-export.mjs';
import { releasePair } from './release-pair.mjs';
import { verifyExport } from './verify-export.mjs';
import { checkAcceptance } from './check-acceptance.mjs';
import { checkCoverage, implementationFiles } from './check-coverage.mjs';

assert.equal(
  Number(process.versions.node.split('.')[0]),
  24,
  'Release acceptance requires Node 24',
);
for (const args of [
  ['install', '--immutable'],
  ['fix', '--check'],
  ['tsc:full'],
  ['lint:all', '--max-warnings', '0'],
  ['prettier:check'],
  ['build:all'],
  ['build:api-reports:only', '--ci'],
]) {
  const result = spawnSync('yarn', args, { stdio: 'inherit' });
  assert.equal(
    result.status,
    0,
    `Required check failed: yarn ${args.join(' ')}`,
  );
}
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const manifest = read('test/acceptance-manifest.json');
for (const path of [
  'coverage/source-state.json',
  'release-evidence/database-source-state.json',
  'release-evidence/oci.json',
  'release-evidence/frontend-oci.json',
  'release-evidence/rhdh-installation.json',
  'release-evidence/frontend-host-manual.json',
  'release-evidence/registry-pair.json',
])
  assert.equal(read(path).sourceHash, sourceState(), `Stale evidence: ${path}`);
checkCoverage(read('coverage/coverage-final.json'), implementationFiles());
checkAcceptance(read('coverage/test-results.json'), manifest, 'unit');
checkAcceptance(
  read('release-evidence/database-tests.json'),
  manifest,
  'database',
);
const exported = verifyExport();
verifyFrontendExport();
const pair = releasePair();
const oci = read('release-evidence/oci.json');
const installed = read('release-evidence/rhdh-installation.json');
assert.equal(
  oci.lockfileHash,
  createHash('sha256').update(readFileSync('yarn.lock')).digest('hex'),
  'Stale OCI dependency evidence',
);
assert.equal(oci.version, exported.version);
assert.equal(installed.passed, true);
assert.equal(installed.target, '1.10.3');
assert(
  installed.artifact.includes(`@${oci.digest}!`),
  'Smoke test used a different artifact',
);
assert(
  installed.frontend.includes(`@${pair.frontend.digest}!`),
  'Host used a different frontend',
);
assert.equal(installed.appPackageName, 'app-next');
assert.equal(installed.standardModuleFederation, true);
const registry = read('release-evidence/registry-pair.json');
assert.equal(registry.platform, pair.platform);
for (const [name, artifact] of [
  ['backend', pair.backend],
  ['frontend', pair.frontend],
]) {
  const confirmed = registry[name];
  assert.equal(
    confirmed.platformDigest,
    artifact.digest,
    'Registry platform manifest differs from tested artifact',
  );
  assert.equal(
    confirmed.packagePath,
    artifact.packagePath,
    'Registry package path mismatch',
  );
  assert.equal(confirmed.confirmed, true, 'Registry confirmation missing');
  assert.equal(
    confirmed.ref,
    name === 'backend' ? installed.artifact : installed.frontend,
    'Installed reference differs from confirmed registry ref',
  );
}
const manual = read('release-evidence/frontend-host-manual.json');
assert.equal(manual.image, installed.image);
assert.equal(manual.frontend, installed.frontend);
assert.equal(manual.backend, installed.artifact);
assert.equal(manual.passed, true);
for (const check of [
  'entity-links',
  'pagination',
  'team-user-data',
  'tab-inventory',
  'overview-exclusion',
  'restart',
  'upgrade',
  'rollback',
])
  assert.equal(
    manual.checks?.[check],
    true,
    `Missing manual host check: ${check}`,
  );
assert(
  Array.isArray(manual.entityContentInventory) &&
    manual.entityContentInventory.length > 0,
  'Missing exact-host extension inventory',
);
for (const phase of [
  'baseline',
  'upgrade',
  'failed-fetch-preservation',
  'restart',
  'pause',
  'rollback',
])
  assert(
    installed.outcomes.some(result => result.phase === phase && result.passed),
    `Missing installation scenario ${phase}`,
  );
writeFileSync(
  'release-evidence/release.json',
  JSON.stringify(
    {
      passed: true,
      sourceCommit: exported.sourceCommit,
      sourceDirty: exported.sourceDirty,
      lockfileHash: oci.lockfileHash,
      backend: installed.artifact,
      frontend: installed.frontend,
      rollbackPair: {
        backend: installed.previous,
        frontend: installed.previousFrontend,
      },
      playwright: 'deferred by user',
      platform: oci.platform,
      target: installed.image,
    },
    null,
    2,
  ),
);
console.log('All required release evidence passed');
