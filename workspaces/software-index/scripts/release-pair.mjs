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
import { readFileSync, writeFileSync } from 'node:fs';
import { sourceState } from './source-state.mjs';
const read = path => JSON.parse(readFileSync(path, 'utf8'));
export function releasePair() {
  const backend = read('release-evidence/oci.json');
  const frontend = read('release-evidence/frontend-oci.json');
  for (const artifact of [backend, frontend]) {
    assert.equal(artifact.sourceHash, sourceState(), 'Stale OCI evidence');
    assert.match(artifact.digest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(artifact.dynamicPackages.length, 1);
  }
  assert.equal(frontend.platform, backend.platform, 'Mixed-platform pair');
  assert.equal(
    frontend.lockfileHash,
    backend.lockfileHash,
    'Mixed dependency pair',
  );
  assert.notEqual(
    backend.tag,
    frontend.tag,
    'Two independent artifacts required',
  );
  const manifest = {
    sourceHash: sourceState(),
    sourceCommit: backend.sourceCommit,
    sourceDirty: backend.sourceDirty || frontend.sourceDirty,
    lockfileHash: backend.lockfileHash,
    platform: backend.platform,
    compatibility: {
      backstage: '1.49.4',
      rhdh: '1.10.3',
      cli: '1.10.8',
      pyxisProjection: '1',
      chiSchema: '2',
    },
    backend,
    frontend,
    registryConfirmed: false,
    exactHostAccepted: false,
    playwright: 'deferred by user',
    rollbackPair: null,
  };
  writeFileSync(
    'release-evidence/release-pair.json',
    JSON.stringify(manifest, null, 2),
  );
  return manifest;
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  releasePair();
  console.log(
    'Local OCI pair recorded; registry and exact-host acceptance still required',
  );
}
