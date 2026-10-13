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

import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:https';
import { Agent } from 'undici';
import { ConfigReader } from '@backstage/config';
import { PyxisClient } from './client';
import { readPyxisConfig, type PyxisSourceConfig } from './config';
// Shared synthetic fixture is never a production package dependency.
// eslint-disable-next-line @backstage/no-relative-monorepo-imports
import baseline from '../../../test/fixtures/pyxis/baseline.json';

describe('actual-tls actual TLS', () => {
  let directory: string;
  let server: Server;
  let config: PyxisSourceConfig;
  let endpoint: string;
  let holdResponse = false;

  const openssl = (...args: string[]) =>
    execFileSync('openssl', args, { cwd: directory, stdio: 'pipe' });

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'pyxis-tls-'));
    openssl(
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
      '/CN=Pyxis Test CA',
    );

    for (const role of ['server', 'client', 'expired']) {
      openssl(
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
      );
      await writeFile(
        join(directory, `${role}.ext`),
        role === 'server'
          ? 'subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n'
          : 'extendedKeyUsage=clientAuth\n',
      );

      if (role === 'expired') {
        await mkdir(join(directory, 'issued'));
        await writeFile(join(directory, 'index.txt'), '');
        await writeFile(join(directory, 'serial'), '01');
        await writeFile(
          join(directory, 'ca.conf'),
          '[ca]\ndefault_ca=test\n[test]\ndatabase=index.txt\nnew_certs_dir=issued\nserial=serial\ncertificate=ca.crt\nprivate_key=ca.key\ndefault_md=sha256\npolicy=policy\n[policy]\ncommonName=supplied\n',
        );
        openssl(
          'ca',
          '-batch',
          '-config',
          'ca.conf',
          '-in',
          'expired.csr',
          '-out',
          'expired.crt',
          '-startdate',
          '200101000000Z',
          '-enddate',
          '200102000000Z',
          '-extfile',
          'expired.ext',
        );
      } else {
        openssl(
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
        );
      }
    }

    server = createServer(
      {
        cert: await readFile(join(directory, 'server.crt')),
        key: await readFile(join(directory, 'server.key')),
        ca: await readFile(join(directory, 'ca.crt')),
        requestCert: true,
        rejectUnauthorized: true,
      },
      (req, res) => {
        req.resume();
        if (holdResponse) {
          return;
        }

        req.on('end', () => {
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              data: {
                get_repository: { error: null, data: baseline.repositories[0] },
              },
            }),
          );
        });
      },
    );

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('no loopback server');
    }

    endpoint = `https://localhost:${address.port}`;
    config = readPyxisConfig(
      new ConfigReader({
        pyxis: {
          sources: {
            internal: {
              endpoint,
              certificateFile: join(directory, 'client.crt'),
              keyFile: join(directory, 'client.key'),
              caFile: join(directory, 'ca.crt'),
              maxAttempts: 1,
              attemptTimeoutMs: 1000,
            },
          },
        },
      }),
    ).sources.internal;
  }, 20000);

  afterAll(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('performs verified mTLS and disposes sockets', async () => {
    const client = await PyxisClient.create(config, 'internal');
    expect(
      (await client.getRepository(baseline.repositories[0]._id, {})).state,
    ).toBe('found');
    await client.close();
    await expect(
      client.getRepository(baseline.repositories[0]._id, {}),
    ).rejects.toThrow();
  });

  it.each(['caller', 'shutdown', 'timeout'])(
    'interrupts an active TLS request on %s and closes its socket',
    async reason => {
      holdResponse = true;
      const client = await PyxisClient.create(config, 'internal');
      const controller = new AbortController();
      const received = new Promise<void>(resolve => {
        server.once('request', () => resolve());
      });
      const closed = new Promise<void>(resolve => {
        server.once('secureConnection', socket => {
          socket.once('close', () => resolve());
        });
      });
      const outcome = client
        .getRepository(baseline.repositories[0]._id, {
          signal: controller.signal,
        })
        .catch(error => error);

      try {
        await received;
        if (reason === 'caller') {
          controller.abort();
        }
        if (reason === 'shutdown') {
          await client.close();
        }
        await expect(outcome).resolves.toMatchObject({
          code: reason === 'timeout' ? 'transport' : 'cancelled',
        });
        await closed;
      } finally {
        holdResponse = false;
        await client.close();
      }
    },
  );

  it.each([
    'untrusted-ca',
    'hostname',
    'expired-client',
    'missing-client',
    'rejected-client',
  ])('rejects %s during a real handshake', async scenario => {
    const changed = {
      ...config,
      ...(scenario === 'untrusted-ca' ? { caFile: undefined } : {}),
      ...(scenario === 'hostname'
        ? { endpoint: endpoint.replace('localhost', '127.0.0.1') }
        : {}),
      ...(scenario === 'expired-client'
        ? {
            certificateFile: join(directory, 'expired.crt'),
            keyFile: join(directory, 'expired.key'),
          }
        : {}),
      ...(scenario === 'rejected-client'
        ? {
            certificateFile: join(directory, 'server.crt'),
            keyFile: join(directory, 'server.key'),
          }
        : {}),
    };
    const client =
      scenario === 'missing-client'
        ? new PyxisClient(
            config,
            new Agent({
              connect: { ca: await readFile(join(directory, 'ca.crt')) },
            }),
            'internal',
          )
        : await PyxisClient.create(changed, 'internal');
    await expect(
      client.getRepository(baseline.repositories[0]._id, {}),
    ).rejects.toThrow('transport');
    await client.close();
  });

  it('rejects unreadable or mismatched key material before requests', async () => {
    await expect(
      PyxisClient.create(
        { ...config, keyFile: join(directory, 'server.key') },
        'internal',
      ),
    ).rejects.toThrow('tls-material');
    await writeFile(join(directory, 'invalid.key'), 'invalid');
    await expect(
      PyxisClient.create(
        { ...config, keyFile: join(directory, 'invalid.key') },
        'internal',
      ),
    ).rejects.toThrow('tls-material');
    await expect(
      PyxisClient.create(
        { ...config, keyFile: join(directory, 'missing.key') },
        'internal',
      ),
    ).rejects.toThrow('tls-material');
  });
});
