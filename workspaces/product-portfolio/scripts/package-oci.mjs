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
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { verifyExport, moduleDirectory } from './verify-export.mjs';

import { resolve } from 'node:path';
import {
  verifyFrontendExport,
  frontendDirectory,
} from './verify-frontend-export.mjs';
const target = process.argv[2] ?? 'backend';
assert(
  ['backend', 'frontend'].includes(target),
  'Expected backend or frontend',
);
const frontend = target === 'frontend';
const tag = frontend
  ? process.env.PRODUCT_PORTFOLIO_FRONTEND_OCI_TAG
  : process.env.PYXIS_OCI_TAG;
const platform = process.env.PYXIS_TARGET_PLATFORM;

assert(
  tag && /^[a-zA-Z0-9][a-zA-Z0-9./:_-]+$/.test(tag) && !tag.endsWith(':latest'),
  'Set the explicit backend/frontend OCI tag (no latest tag)',
);
assert(
  platform && /^linux\/(amd64|arm64)$/.test(platform),
  'Set the approved PYXIS_TARGET_PLATFORM',
);

const inventory = frontend ? verifyFrontendExport() : verifyExport();
const before = execFileSync('git', ['diff', '--', '.'], { encoding: 'utf8' });
execFileSync(
  process.execPath,
  [
    resolve('node_modules/@red-hat-developer-hub/cli/bin/rhdh-cli'),
    'plugin',
    'package',
    '--tag',
    tag,
    '--platform',
    platform,
    '--container-tool',
    'podman',
  ],
  { cwd: frontend ? frontendDirectory : moduleDirectory, stdio: 'inherit' },
);
const inspect = JSON.parse(
  execFileSync('podman', ['image', 'inspect', tag], { encoding: 'utf8' }),
)[0];

const annotation = inspect.Annotations?.['io.backstage.dynamic-packages'];
assert(annotation, 'Missing dynamic-package metadata');

const metadata = JSON.parse(Buffer.from(annotation, 'base64').toString('utf8'));
assert(
  Array.isArray(metadata) && metadata.length === 1,
  'Expected exactly one annotated dynamic package',
);
const packagePaths = Object.keys(metadata[0]);
assert.equal(packagePaths.length, 1, 'Expected exactly one package path');
const packagePath = packagePaths[0];
assert.match(
  packagePath,
  /^[a-zA-Z0-9._-]+$/,
  'Invalid annotated package path',
);
assert.equal(
  metadata[0][packagePath].name,
  inventory.name,
  'Image contains a different package',
);
assert.equal(
  metadata[0][packagePath].version,
  inventory.version,
  'Image contains a different version',
);
assert.equal(
  execFileSync('git', ['diff', '--', '.'], { encoding: 'utf8' }),
  before,
  'Packaging changed tracked files',
);

const digest = inspect.Digest;
assert(
  /^sha256:[a-f0-9]{64}$/.test(digest),
  'Image has no immutable manifest digest',
);

writeFileSync(
  `release-evidence/${frontend ? 'frontend-' : ''}oci.json`,
  JSON.stringify(
    {
      ...inventory,
      tag,
      platform,
      digest,
      configDigest: inspect.Id,
      layerDigests: inspect.RootFS?.Layers,
      registryConfirmed: false,
      dynamicPackages: metadata,
      packagePath,
      published: false,
    },
    null,
    2,
  ),
);

console.log(`Packaged ${tag}@${digest}. No registry push performed.`);
