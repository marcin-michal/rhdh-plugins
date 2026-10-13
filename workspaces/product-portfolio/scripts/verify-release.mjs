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
  installed.artifact.endsWith(`@${oci.digest}`),
  'Smoke test used a different artifact',
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
      artifact: installed.artifact,
      platform: oci.platform,
      target: installed.image,
    },
    null,
    2,
  ),
);
console.log('All required release evidence passed');
