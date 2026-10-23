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
import { sourceState } from './source-state.mjs';
import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

// Host commands are read from the exact approved image's installation contract.
// No alternate installer or newer host can satisfy this gate.
const image = process.env.PYXIS_RHDH_IMAGE;
const artifact = process.env.PYXIS_OCI_REF;
const previous = process.env.PYXIS_PREVIOUS_OCI_REF;
const frontend = process.env.PRODUCT_PORTFOLIO_FRONTEND_OCI_REF;
const previousFrontend =
  process.env.PRODUCT_PORTFOLIO_PREVIOUS_FRONTEND_OCI_REF;
assert.equal(
  process.env.APP_CONFIG_app_packageName,
  'app-next',
  'Exact host requires app-next',
);
assert.equal(
  process.env.ENABLE_STANDARD_MODULE_FEDERATION,
  'true',
  'Exact host requires standard Module Federation',
);
const platform = process.env.PYXIS_TARGET_PLATFORM;
assert(
  image && /^.+@sha256:[a-f0-9]{64}$/.test(image),
  'Set PYXIS_RHDH_IMAGE to the approved RHDH 1.10.3 digest',
);
for (const ref of [artifact, previous, frontend, previousFrontend])
  assert(
    ref && /^oci:\/\/.+@sha256:[a-f0-9]{64}![a-zA-Z0-9._-]+$/.test(ref),
    'Set current and previous backend/frontend OCI refs to platform digests with verified !package-path suffixes',
  );
assert.notEqual(
  artifact,
  previous,
  'Upgrade and rollback require distinct artifacts',
);
assert(
  /^linux\/(amd64|arm64)$/.test(platform ?? ''),
  'Set PYXIS_TARGET_PLATFORM',
);
assert(
  process.env.PYXIS_RHDH_CONFIG,
  'Set PYXIS_RHDH_CONFIG to the approved isolated test-host base configuration',
);
const command = name => {
  const value = JSON.parse(process.env[name] ?? 'null');
  assert(
    Array.isArray(value) &&
      value.length &&
      value.every(v => typeof v === 'string'),
    `Set ${name} to the exact image command as a JSON argument array`,
  );
  return value;
};
const installer = command('PYXIS_RHDH_INSTALL_COMMAND');
const startCommand = command('PYXIS_RHDH_START_COMMAND');
const directory = mkdtempSync(join(tmpdir(), 'pyxis-rhdh-smoke-'));
const evidence = resolve('release-evidence');
mkdirSync(evidence, { recursive: true });
const name = `pyxis-rhdh-smoke-${process.pid}`;
let running = false;
let failSource = false;
let failures = 0;
let requests = 0;
const token = randomBytes(24).toString('hex');
const podman = args =>
  execFileSync('podman', args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
const openssl = args =>
  execFileSync('openssl', args, { cwd: directory, stdio: 'pipe' });
const baseline = JSON.parse(
  readFileSync('test/fixtures/pyxis/baseline.json', 'utf8'),
);
const outcomes = [];
let fixture;
try {
  openssl([
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    'ca.key',
    '-out',
    'ca.crt',
    '-days',
    '2',
    '-subj',
    '/CN=Pyxis smoke CA',
  ]);
  for (const role of ['server', 'client']) {
    openssl([
      'req',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      `${role}.key`,
      '-out',
      `${role}.csr`,
      '-subj',
      `/CN=${role === 'server' ? 'localhost' : role}`,
    ]);
    writeFileSync(
      join(directory, `${role}.ext`),
      role === 'server'
        ? 'subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n'
        : 'extendedKeyUsage=clientAuth\n',
    );
    openssl([
      'x509',
      '-req',
      '-in',
      `${role}.csr`,
      '-CA',
      'ca.crt',
      '-CAkey',
      'ca.key',
      '-CAcreateserial',
      '-out',
      `${role}.crt`,
      '-days',
      '2',
      '-extfile',
      `${role}.ext`,
    ]);
  }
  fixture = createServer(
    {
      cert: readFileSync(join(directory, 'server.crt')),
      key: readFileSync(join(directory, 'server.key')),
      ca: readFileSync(join(directory, 'ca.crt')),
      requestCert: true,
      rejectUnauthorized: true,
    },
    (req, res) => {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        requests += 1;
        if (failSource) {
          failures += 1;
          res.writeHead(503).end();
          return;
        }
        try {
          const { query, variables } = JSON.parse(
            Buffer.concat(chunks).toString('utf8'),
          );
          const operation = query.match(
            /(find_product_listings|find_repositories|get_team)\(/,
          )?.[1];
          assert(operation, 'Unexpected source operation');
          const records = {
            find_product_listings: baseline.listings,
            find_repositories: baseline.repositories,
          }[operation];
          const result = records
            ? {
                error: null,
                data: records.slice(
                  variables.page * variables.pageSize,
                  (variables.page + 1) * variables.pageSize,
                ),
                page: variables.page,
                page_size: variables.pageSize,
                total: records.length,
              }
            : {
                error: null,
                data: baseline.teams.find(team => team._id === variables.id),
              };
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ data: { [operation]: result } }));
        } catch {
          res.writeHead(400).end();
        }
      });
    },
  );
  await new Promise(resolveListen =>
    fixture.listen(0, '127.0.0.1', resolveListen),
  );
  const port = Number(process.env.PYXIS_SMOKE_PORT ?? '17007');
  const mount = [
    '--userns=keep-id',
    '--user',
    String(process.getuid()),
    '--network=host',
    '--env',
    'APP_CONFIG_app_packageName=app-next',
    '--env',
    'ENABLE_STANDARD_MODULE_FEDERATION=true',
    '--platform',
    platform,
    '--volume',
    `${directory}:/smoke:Z`,
    '--volume',
    `${resolve(process.env.PYXIS_RHDH_CONFIG)}:/smoke-base.yaml:ro,Z`,
  ];
  // The image identity is retained as evidence; DevHub supplies the approved digest.
  const inspected = JSON.parse(podman(['image', 'inspect', image]))[0];
  assert(
    (inspected.Config?.Labels?.version ?? '').startsWith('1.10.3'),
    'Image version label must prove RHDH 1.10.3',
  );
  const writeConfig = (ref, paused) => {
    writeFileSync(
      join(directory, 'dynamic-plugins.yaml'),
      JSON.stringify({
        plugins: [
          { package: ref, disabled: false },
          {
            package: ref === previous ? previousFrontend : frontend,
            disabled: false,
          },
        ],
      }),
    );
    writeFileSync(
      join(directory, 'app-config.yaml'),
      JSON.stringify({
        app: {
          extensions: [
            {
              'entity-content:catalog/overview': {
                config: {
                  filter: {
                    $not: {
                      'metadata.annotations.pyxis.redhat.com/source-instance': {
                        $exists: true,
                      },
                    },
                  },
                },
              },
            },
          ],
        },
        backend: {
          baseUrl: `http://localhost:${port}`,
          listen: { host: '127.0.0.1', port },
          auth: {
            externalAccess: [
              { type: 'static', options: { token, subject: 'pyxis-smoke' } },
            ],
          },
        },
        dynamicPlugins: { rootDirectory: '/smoke/dynamic-plugins-root' },
        catalog: {
          rules: [{ allow: ['Resource', 'Group', 'User'] }],
          processingInterval: { seconds: 1 },
          providers: {
            pyxis: {
              internal: {
                paused,
                schedule: {
                  frequencySeconds: 2,
                  timeoutSeconds: 30,
                  initialDelaySeconds: 0,
                },
              },
            },
          },
        },
        pyxis: {
          sources: {
            internal: {
              endpoint: `https://localhost:${fixture.address().port}`,
              certificateFile: '/smoke/client.crt',
              keyFile: '/smoke/client.key',
              caFile: '/smoke/ca.crt',
              maxAttempts: 1,
            },
          },
        },
      }),
    );
  };
  const stop = phase => {
    if (!running) return;
    writeFileSync(join(evidence, `${phase}.log`), podman(['logs', name]));
    podman(['stop', '--time', '15', name]);
    running = false;
  };
  const launch = (ref, paused, phase) => {
    writeConfig(ref, paused);
    writeFileSync(
      join(evidence, `${phase}-installer.log`),
      podman([
        'run',
        '--rm',
        ...mount,
        '--workdir',
        '/smoke',
        '--entrypoint',
        installer[0],
        image,
        ...installer.slice(1),
      ]),
    );
    podman([
      'run',
      '--detach',
      '--rm',
      '--name',
      name,
      ...mount,
      '--entrypoint',
      startCommand[0],
      image,
      ...startCommand.slice(1),
    ]);
    running = true;
  };
  const catalog = async () => {
    const response = await fetch(
      `http://localhost:${port}/api/catalog/entities?filter=metadata.namespace=pyxis`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    assert(response.ok, `Catalog HTTP ${response.status}`);
    return response.json();
  };
  const until = async condition => {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      try {
        if (await condition()) return;
      } catch {
        /* startup or processing still pending */
      }
      await delay(250);
    }
    throw new Error('Exact-host convergence timed out');
  };
  const assertGraph = async () => {
    const entities = await catalog();
    assert.equal(entities.length, 9);
    const relations = entities.flatMap(entity => entity.relations ?? []);
    assert.equal(
      relations.filter(r => r.type === 'pyxisHasRepository').length,
      3,
    );
    assert.equal(
      relations.filter(r => r.type === 'pyxisRepositoryOf').length,
      3,
    );
    return true;
  };
  for (const [phase, ref] of [
    ['baseline', previous],
    ['upgrade', artifact],
  ]) {
    launch(ref, false, phase);
    await until(assertGraph);
    outcomes.push({ phase, passed: true });
    stop(phase);
  }
  launch(artifact, false, 'preservation');
  await until(assertGraph);
  failSource = true;
  await until(() => failures > 0);
  await assertGraph();
  outcomes.push({ phase: 'failed-fetch-preservation', passed: true });
  stop('preservation');
  launch(artifact, false, 'restart');
  await until(assertGraph);
  outcomes.push({ phase: 'restart', passed: true });
  stop('restart');
  launch(artifact, true, 'pause');
  await until(assertGraph);
  const pausedRequests = requests;
  await delay(4000);
  assert.equal(
    requests,
    pausedRequests,
    'Paused provider made source requests',
  );
  outcomes.push({ phase: 'pause', passed: true });
  stop('pause');
  failSource = false;
  launch(previous, false, 'rollback');
  await until(assertGraph);
  outcomes.push({ phase: 'rollback', passed: true });
  stop('rollback');
  writeFileSync(
    join(evidence, 'rhdh-installation.json'),
    JSON.stringify(
      {
        sourceHash: sourceState(),
        frontend,
        previousFrontend,
        appPackageName: 'app-next',
        standardModuleFederation: true,
        frontendManualAcceptance: false,
        target: '1.10.3',
        image,
        artifact,
        previous,
        platform,
        outcomes,
        observedEntities: 9,
        directEdges: 3,
        passed: true,
      },
      null,
      2,
    ),
  );
} finally {
  if (running) {
    try {
      writeFileSync(join(evidence, 'failure.log'), podman(['logs', name]));
      podman(['stop', '--time', '15', name]);
    } catch {
      /* retain original failure */
    }
  }
  if (fixture) {
    fixture.closeAllConnections();
    await new Promise(resolveClose => fixture.close(resolveClose));
  }
  rmSync(directory, { recursive: true, force: true });
}
