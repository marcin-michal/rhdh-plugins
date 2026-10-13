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
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('release-evidence', { recursive: true });
const sourceHash = sourceState();
const result = spawnSync(
  'yarn',
  [
    'test',
    '--ci',
    '--watch=false',
    '--runInBand',
    '--json',
    '--outputFile=release-evidence/database-tests.json',
    'catalog.integration|scheduler.database.integration',
  ],
  {
    stdio: 'inherit',
    env: { ...process.env, CI: 'true', PYXIS_DATABASE_MATRIX: 'required' },
  },
);
if (result.status !== 0) process.exit(result.status ?? 1);
const gate = spawnSync(
  process.execPath,
  [
    'scripts/check-acceptance.mjs',
    'release-evidence/database-tests.json',
    'database',
  ],
  { stdio: 'inherit' },
);
assert.equal(gate.status, 0);
assert.equal(sourceState(), sourceHash, 'Source changed during database tests');
writeFileSync(
  'release-evidence/database-source-state.json',
  JSON.stringify({ sourceHash }),
);
