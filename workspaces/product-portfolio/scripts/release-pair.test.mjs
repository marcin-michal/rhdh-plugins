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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceState } from './source-state.mjs';
import { releasePair } from './release-pair.mjs';

test('release pair rejects stale, mixed-platform and combined-image evidence', () => {
  const original = process.cwd();
  const directory = mkdtempSync(join(tmpdir(), 'portfolio-release-pair-'));
  try {
    process.chdir(directory);
    for (const name of [
      'plugins',
      'packages',
      'scripts',
      'test',
      'release-evidence',
    ])
      mkdirSync(name);
    for (const name of [
      'package.json',
      'yarn.lock',
      'tsconfig.json',
      '.yarnrc.yml',
      'app-config.yaml',
    ])
      writeFileSync(name, '{}');
    writeFileSync('plugins/view.tsx', 'export const View = () => null;');
    const before = sourceState();
    writeFileSync('plugins/view.tsx', 'export const View = () => <main/>;');
    assert.notEqual(
      sourceState(),
      before,
      'TSX changes must invalidate evidence',
    );
    const artifact = {
      sourceHash: sourceState(),
      sourceCommit: 'test-commit',
      sourceDirty: false,
      lockfileHash: 'lock',
      platform: 'linux/amd64',
      digest: 'sha256:' + 'a'.repeat(64),
      dynamicPackages: [{ plugin: { name: 'test' } }],
    };
    const backend = { ...artifact, tag: 'local/backend:1' };
    const frontend = { ...artifact, tag: 'local/frontend:1' };
    const write = value =>
      writeFileSync(
        'release-evidence/frontend-oci.json',
        JSON.stringify(value),
      );
    writeFileSync('release-evidence/oci.json', JSON.stringify(backend));
    write(frontend);
    assert.equal(releasePair().exactHostAccepted, false);
    write({ ...frontend, sourceHash: before });
    assert.throws(() => releasePair(), /Stale OCI evidence/);
    write({ ...frontend, platform: 'linux/arm64' });
    assert.throws(() => releasePair(), /Mixed-platform/);
    write({ ...frontend, tag: backend.tag });
    assert.throws(() => releasePair(), /independent artifacts/);
    write({ ...frontend, dynamicPackages: [{}, {}] });
    assert.throws(() => releasePair());
  } finally {
    process.chdir(original);
    rmSync(directory, { recursive: true, force: true });
  }
});
