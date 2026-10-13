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
import { resolve } from 'node:path';
import { checkAcceptance } from './check-acceptance.mjs';
import { checkCoverage } from './check-coverage.mjs';

test('acceptance gate rejects missing and skipped scenarios', () => {
  const manifest = {
    scenarios: [
      {
        id: 'vendor-admission',
        jobs: ['unit'],
        tests: ['vendor-admission admission'],
      },
    ],
  };
  const results = {
    success: true,
    numPendingTests: 0,
    numFailedTests: 0,
    testResults: [
      {
        assertionResults: [
          { fullName: 'vendor-admission admission', status: 'passed' },
        ],
      },
    ],
  };

  checkAcceptance(results, manifest);
  assert.throws(() =>
    checkAcceptance({ ...results, testResults: [] }, manifest),
  );
  assert.throws(() =>
    checkAcceptance({ ...results, numPendingTests: 1 }, manifest),
  );
});

test('acceptance gate rejects missing, skipped and failed CHI scenarios', () => {
  const manifest = {
    scenarios: [
      {
        id: 'T35-chi-candidate-keyset',
        jobs: ['unit'],
        tests: ['chi-candidate-keyset'],
      },
    ],
  };
  const assertion = {
    fullName: 'chi-candidate-keyset exhausts pages',
    status: 'passed',
  };
  const results = {
    success: true,
    numPendingTests: 0,
    numFailedTests: 0,
    testResults: [{ assertionResults: [assertion] }],
  };
  checkAcceptance(results, manifest);
  assert.throws(() =>
    checkAcceptance({ ...results, testResults: [] }, manifest),
  );
  assert.throws(() =>
    checkAcceptance(
      {
        ...results,
        success: false,
        numFailedTests: 1,
        testResults: [
          { assertionResults: [{ ...assertion, status: 'failed' }] },
        ],
      },
      manifest,
    ),
  );
});

test('coverage gate rejects lowered, missing and uncovered domain evidence', () => {
  const filename = 'plugins/pyxis-node/src/normalization.ts';
  const report = {
    [resolve(filename)]: {
      s: { 0: 1 },
      f: { 0: 1 },
      b: { 0: [1, 1] },
      statementMap: { 0: { start: { line: 1 } } },
    },
  };

  checkCoverage(report, [filename]);
  report[resolve(filename)].b[0][1] = 0;
  assert.throws(() => checkCoverage(report, [filename]));
  assert.throws(() => checkCoverage({}, [filename]));
  report[resolve(filename)].b[0][1] = 1;
  report[resolve(filename)].s[0] = 0;
  assert.throws(() => checkCoverage(report, [filename]));
});
