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
mkdirSync('coverage', { recursive: true });
const sourceHash = sourceState();
const run = (program, args) => {
  const result = spawnSync(program, args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      CI: 'true',
      JEST_JUNIT_OUTPUT_DIR: 'coverage',
      JEST_JUNIT_OUTPUT_NAME: 'junit.xml',
    },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
run('yarn', [
  'test',
  '--ci',
  '--watch=false',
  '--runInBand',
  '--coverage',
  '--json',
  '--outputFile=coverage/test-results.json',
  '--reporters=default',
  '--reporters=jest-junit',
  ...process.argv.slice(2),
]);
run(process.execPath, ['scripts/check-coverage.mjs']);
run(process.execPath, ['scripts/check-acceptance.mjs']);
run(process.execPath, ['--test', 'scripts/gates.test.mjs']);

assert.equal(sourceState(), sourceHash, 'Source changed during tests');
writeFileSync('coverage/source-state.json', JSON.stringify({ sourceHash }));
