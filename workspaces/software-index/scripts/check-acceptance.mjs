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
import { readFileSync } from 'node:fs';

export function checkAcceptance(results, manifest, job = 'unit') {
  assert.equal(results.success, true, 'Required test execution failed');
  assert.equal(
    results.numPendingTests,
    0,
    'Skipped required tests are forbidden',
  );
  assert.equal(
    results.numFailedTests,
    0,
    'Failed required tests are forbidden',
  );

  const assertions = results.testResults.flatMap(
    result => result.assertionResults,
  );

  for (const scenario of manifest.scenarios.filter(scenario =>
    scenario.jobs.includes(job),
  )) {
    for (const pattern of scenario.tests) {
      const matches = assertions.filter(assertion =>
        new RegExp(pattern).test(assertion.fullName),
      );
      assert(
        matches.length,
        `${scenario.id}: missing required scenario ${pattern}`,
      );
      assert(
        matches.every(assertion => assertion.status === 'passed'),
        `${scenario.id}: scenario did not pass`,
      );
    }
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  checkAcceptance(
    JSON.parse(
      readFileSync(process.argv[2] ?? 'coverage/test-results.json', 'utf8'),
    ),
    JSON.parse(readFileSync('test/acceptance-manifest.json', 'utf8')),
    process.argv[3] ?? 'unit',
  );
  console.log('Required scenario manifest passed');
}
