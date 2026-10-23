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
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';

export function checkCoverage(report, implementationFiles) {
  const totals = {
    statements: [0, 0],
    branches: [0, 0],
    functions: [0, 0],
    lines: [0, 0],
  };
  const gates = { statements: 95, lines: 95, functions: 95, branches: 90 };

  for (const filename of implementationFiles) {
    const entry = report[resolve(filename)];
    assert(entry, `Missing coverage for ${filename}`);

    const counts = {
      statements: Object.values(entry.s),
      functions: Object.values(entry.f),
      branches: Object.values(entry.b).flat(),
      lines: Object.values(
        Object.fromEntries(
          Object.entries(entry.statementMap).map(([id, location]) => [
            location.start.line,
            Math.max(
              ...Object.keys(entry.statementMap)
                .filter(
                  other =>
                    entry.statementMap[other].start.line ===
                    location.start.line,
                )
                .map(other => entry.s[other]),
            ),
          ]),
        ),
      ),
    };

    for (const [kind, values] of Object.entries(counts)) {
      totals[kind][0] += values.filter(value => value > 0).length;
      totals[kind][1] += values.length;
    }

    if (
      /(normalization|inventory|projection|reconciliation|chiSelection|chiNormalization|chiSummary)\.ts$/.test(
        filename,
      )
    ) {
      assert(
        counts.branches.every(value => value > 0),
        `100% domain branch coverage required: ${filename}`,
      );
    }
  }

  for (const [kind, [covered, total]] of Object.entries(totals)) {
    assert(
      total === 0 || (covered / total) * 100 >= gates[kind],
      `${kind} coverage ${
        total ? ((covered / total) * 100).toFixed(2) : 100
      }% < ${gates[kind]}%`,
    );
  }

  return totals;
}

function walk(directory) {
  return readdirSync(directory).flatMap(name => {
    const filename = resolve(directory, name);
    return statSync(filename).isDirectory() ? walk(filename) : [filename];
  });
}

export function implementationFiles() {
  // Only declarations, type/re-export entrypoints, fixtures, support and generated code are excluded.
  return walk('plugins')
    .filter(
      filename =>
        /\/src\/.*\.tsx?$/.test(filename) &&
        !/\/(node_modules|dist|dist-types|dist-dynamic|testUtils)\//.test(
          filename,
        ) &&
        !/(\.d\.ts|\.test\.tsx?|\/index\.ts|\/ports\.ts|\/chi\.ts|\/setupTests\.ts|\/testSupport\.ts)$/.test(
          filename,
        ),
    )
    .map(filename => relative(process.cwd(), filename));
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  checkCoverage(
    JSON.parse(
      readFileSync(process.argv[2] ?? 'coverage/coverage-final.json', 'utf8'),
    ),
    implementationFiles(),
  );
  console.log('Coverage gates passed');
}
