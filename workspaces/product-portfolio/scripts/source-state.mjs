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

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function sourceState() {
  const walk = directory =>
    readdirSync(directory)
      .sort()
      .flatMap(name => {
        if (
          [
            'node_modules',
            'dist',
            'dist-types',
            'dist-dynamic',
            'coverage',
            'release-evidence',
          ].includes(name)
        )
          return [];
        const filename = join(directory, name);
        return statSync(filename).isDirectory()
          ? walk(filename)
          : /\.(ts|js|mjs|cjs|json|ya?ml)$/.test(name)
          ? [filename]
          : [];
      });
  const files = [
    'package.json',
    'yarn.lock',
    'tsconfig.json',
    ...['plugins', 'packages', 'scripts', 'test'].flatMap(walk),
  ].sort();
  const digest = createHash('sha256');
  for (const filename of files)
    digest
      .update(filename)
      .update('\0')
      .update(readFileSync(filename))
      .update('\0');
  return digest.digest('hex');
}
