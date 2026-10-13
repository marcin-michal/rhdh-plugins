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

import { ConfigReader } from '@backstage/config';
import {
  canonicalId,
  parseSourceRecord,
  classifyVendor,
  isObjectId,
  normalizeRoster,
  sourceName,
  sourceRef,
  sourceSchemas,
} from './normalization';
import { readPyxisConfig } from './config';
import { unmatchedHostIdentityResolver } from './identity';

describe.each(['redhat-only', 'redhat-or-unlabeled'] as const)(
  'vendor-admission with %s',
  policy => {
    it.each([
      [{ vendor_label: 'redhat' }, 'redhat', 'admit', 'admit'],
      [{ vendor_label: 'RedHat' }, 'other', 'exclude', 'exclude'],
      [{ vendor_label: ' redhat' }, 'other', 'exclude', 'exclude'],
      [{ vendor_label: '' }, 'other', 'exclude', 'exclude'],
      [{ vendor_label: null }, 'null-or-missing', 'unresolved', 'admit'],
      [{}, 'missing', 'unresolved', 'admit'],
      [{ vendor_label: 4 }, 'unreadable', 'unresolved', 'unresolved'],
      [{ vendor_label: {} }, 'unreadable', 'unresolved', 'unresolved'],
      [{ vendor_label: false }, 'unreadable', 'unresolved', 'unresolved'],
      [{ vendor_label: undefined }, 'unreadable', 'unresolved', 'unresolved'],
    ] as const)(
      'retains exact wire evidence %#',
      (record, classification, strict, broad) => {
        expect(classifyVendor(record, policy)).toMatchObject({
          classification,
          decision: policy === 'redhat-only' ? strict : broad,
          policy,
          wirePresence: Object.hasOwn(record, 'vendor_label')
            ? 'present'
            : 'missing',
        });
      },
    );

    it('preserves authoritative null evidence without overriding the selected policy', () => {
      const authority = {
        authority: 'source-export',
        version: '1',
        value: null,
      };
      expect(
        classifyVendor({ vendor_label: null }, policy, authority),
      ).toMatchObject({
        classification: 'explicit-null',
        decision: policy === 'redhat-only' ? 'unresolved' : 'admit',
        storedPresence: authority,
      });

      for (const storedPresence of [
        { ...authority, authority: '' },
        { ...authority, version: '' },
      ]) {
        expect(
          classifyVendor({ vendor_label: null }, policy, storedPresence)
            .classification,
        ).toBe('null-or-missing');
      }

      expect(classifyVendor({}, policy, authority).classification).toBe(
        'missing',
      );
    });
  },
);

it('vendor-admission defaults to strict admission, including authoritative null evidence', () => {
  expect(classifyVendor({ vendor_label: null })).toMatchObject({
    policy: 'redhat-only',
    decision: 'unresolved',
  });
});

describe('source-normalization source validation', () => {
  it('canonicalizes IDs and strips fields outside projections', () => {
    expect(
      sourceSchemas.listing.parse({
        _id: 'ABCDEF000000000000000001',
        contacts: [{ email: 'unused' }],
      }),
    ).toEqual({ _id: 'abcdef000000000000000001' });
    expect(
      sourceSchemas.repository.parse({
        _id: '100000000000000000000001',
        vendor_label: null,
      }),
    ).toHaveProperty('vendor_label', null);
    for (const value of [
      null,
      {},
      { _id: 'bad' },
      { _id: '100000000000000000000001', last_update_date: 'yesterday' },
    ]) {
      expect(sourceSchemas.listing.safeParse(value).success).toBe(false);
    }
  });
});

describe('stable-identity stable identity', () => {
  it('matches a golden SHA256/base32 tuple vector', () => {
    expect(
      sourceName({ sourceInstance: 'internal', kind: 'user', id: 'person-A' }),
    ).toBe('u-sagdq6u4a4r6jgpfskb66hrx3wopbdcl2x4b6yn7euo3ulm5cm7q');
    expect(
      sourceRef({ sourceInstance: 'internal', kind: 'repository', id: 'repo' }),
    ).toMatch(/^resource:pyxis\/r-[a-z2-7]{52}$/);
    expect(
      sourceRef({ sourceInstance: 'internal', kind: 'listing', id: 'listing' }),
    ).toMatch(/^resource:pyxis\/l-/);
    expect(
      sourceRef({ sourceInstance: 'internal', kind: 'team', id: 'team' }),
    ).toMatch(/^group:pyxis\/t-/);
    expect(canonicalId('ABCDEF000000000000000001')).toBe(
      'abcdef000000000000000001',
    );
    expect(canonicalId('Opaque-ID')).toBe('Opaque-ID');
    expect(isObjectId('')).toBe(false);
  });

  it('separates source instance, kind, case and Unicode without truncation', () => {
    const keys = ['User', 'user', 'é', 'e\u0301', 'x'.repeat(10000)].map(id =>
      sourceName({ sourceInstance: 'internal', kind: 'user', id }),
    );
    expect(new Set(keys).size).toBe(5);
    expect(keys.every(key => key.length === 54)).toBe(true);
    expect(
      sourceName({ sourceInstance: 'other', kind: 'user', id: 'User' }),
    ).not.toBe(keys[0]);
  });
});

describe('membership-roster roster evidence', () => {
  const team = { _id: '300000000000000000000001' };
  const time = '2026-01-01T00:00:00Z';

  it('distinguishes empty, missing and malformed membership', () => {
    expect(
      normalizeRoster('internal', { ...team, members: [] }, time).completeness,
    ).toBe('complete');
    expect(normalizeRoster('internal', team, time).completeness).toBe(
      'unavailable',
    );
    expect(
      normalizeRoster('internal', { ...team, members: [null] }, time)
        .completeness,
    ).toBe('partial');
  });

  it('deduplicates identical members and retains roles with conflicting duplicate evidence', () => {
    const member = { user_id: 'User', role: 'Member', added_date: time };
    const roster = normalizeRoster(
      'internal',
      {
        ...team,
        last_update_date: time,
        members: [
          member,
          member,
          { ...member, role: 'Manager' },
          { user_id: 'Other' },
        ],
      },
      time,
    );
    expect(roster).toMatchObject({
      completeness: 'partial',
      organizationalCurrency: 'unverified',
      sourceUpdatedAt: time,
    });
    expect(roster.members).toHaveLength(2);
    expect(roster.members[0]).toMatchObject({
      role: 'Member',
      addedDate: time,
    });
  });
});

describe('identity-coexistence identity coexistence', () => {
  it('returns explicit unmatched bindings without guessing profiles', async () => {
    const result = await unmatchedHostIdentityResolver.resolve(
      [{ sourceInstance: 'internal', kind: 'user', id: 'employee' }],
      {},
    );
    expect(result.state).toBe('complete');
    if (result.state !== 'complete') throw new Error('incomplete binding read');
    expect(result.data[0]).toEqual(
      expect.objectContaining({
        state: 'unmatched',
        authority: 'mapping-authority-unconfigured',
      }),
    );
    expect(JSON.stringify(result)).not.toMatch(/email|hostRef/);
    await expect(
      unmatchedHostIdentityResolver.resolve([], {
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrow('cancelled');
  });
});

describe('configuration configuration', () => {
  const source = {
    endpoint: 'https://pyxis.example.test/graphql',
    certificateFile: '/secret/cert',
    keyFile: '/secret/key',
  };

  it('supports absent configuration, defaults and independent instances', () => {
    expect(readPyxisConfig(new ConfigReader({}))).toEqual({
      sources: {},
      providers: {},
    });

    const result = readPyxisConfig(
      new ConfigReader({
        pyxis: { sources: { internal: source, secondary: source } },
        catalog: {
          providers: {
            pyxis: {
              internal: {},
              secondary: { vendorPolicy: 'redhat-or-unlabeled' },
            },
          },
        },
      }),
    );
    expect(result.sources.internal).toMatchObject({
      pageSize: 100,
      maxAttempts: 3,
      concurrency: 4,
    });
    expect(result.providers.internal).toMatchObject({
      namespace: 'pyxis',
      absenceDeletion: 'retain',
      paused: false,
      vendorPolicy: 'redhat-only',
      chi: {
        enabled: true,
        refreshIntervalSeconds: 900,
        retryIntervalSeconds: 120,
        staleAfterSeconds: 3600,
        readTimeoutSeconds: 300,
        maxCandidateRecords: 100000,
        expectedArchitectures: {},
      },
    });
    expect(result.providers.secondary.vendorPolicy).toBe('redhat-or-unlabeled');
    expect(result.sources.internal).not.toHaveProperty('vendorPolicy');
    // Backstage treats an explicit YAML null as an unset configuration value.
    expect(
      readPyxisConfig(
        new ConfigReader({
          pyxis: { sources: { internal: source } },
          catalog: {
            providers: { pyxis: { internal: { vendorPolicy: null } } },
          },
        }),
      ).providers.internal.vendorPolicy,
    ).toBe('redhat-only');
  });

  it.each([
    { endpoint: 'http://example.test' },
    { endpoint: 'https://user:secret@example.test' },
    { endpoint: 'https://example.test?secret=x' },
    { keyFile: undefined },
    { pageSize: 501 },
    { concurrency: 0 },
    { rejectUnauthorized: false },
    { vendorPolicy: 'redhat-or-unlabeled' },
  ])('rejects invalid source configuration %#', change => {
    expect(() =>
      readPyxisConfig(
        new ConfigReader({
          pyxis: { sources: { internal: { ...source, ...change } } },
        }),
      ),
    ).toThrow('configuration');
  });

  it('rejects bad instance IDs, namespace drift, unknown references and unvalidated deletion', () => {
    expect(() =>
      readPyxisConfig(
        new ConfigReader({ pyxis: { sources: { Invalid: source } } }),
      ),
    ).toThrow('instance');
    expect(() =>
      readPyxisConfig(
        new ConfigReader({
          catalog: { providers: { pyxis: { missing: {} } } },
        }),
      ),
    ).toThrow('unknown');

    for (const provider of [
      { namespace: 'default' },
      { vendorPolicy: 'all' },
      { vendorPolicy: '' },
      { vendorPolicy: 1 },
      { absenceDeletion: 'confirmed-internal-404' },
      { schedule: { timeoutSeconds: 0 } },
    ]) {
      expect(() =>
        readPyxisConfig(
          new ConfigReader({
            pyxis: { sources: { internal: source } },
            catalog: { providers: { pyxis: { internal: provider } } },
          }),
        ),
      ).toThrow('configuration');
    }
  });

  it.each([
    { retryIntervalSeconds: 901 },
    { staleAfterSeconds: 899 },
    { maxImages: 9, maxArchitectureSlots: 8 },
    { maxSnapshotBytes: 100 },
    {
      expectedArchitectures: {
        notAnObjectId: { '9.4': ['amd64'] },
      },
    },
    {
      expectedArchitectures: {
        '200000000000000000000001': { '*': ['amd64'] },
      },
    },
    {
      expectedArchitectures: {
        '200000000000000000000001': { '9.4': ['amd64', 'amd64'] },
      },
    },
  ])('rejects invalid CHI configuration %#', chi => {
    expect(() =>
      readPyxisConfig(
        new ConfigReader({
          pyxis: { sources: { internal: source } },
          catalog: { providers: { pyxis: { internal: { chi } } } },
        }),
      ),
    ).toThrow('provider-configuration');
  });

  it('rejects enabled CHI when catalog processing is disabled', () => {
    expect(() =>
      readPyxisConfig(
        new ConfigReader({
          pyxis: { sources: { internal: source } },
          catalog: {
            processingInterval: false,
            providers: { pyxis: { internal: {} } },
          },
        }),
      ),
    ).toThrow('requires-catalog-processing');
  });
});

it('source-normalization public decoder validates the minimal source record', () => {
  expect(
    parseSourceRecord('team', {
      _id: '300000000000000000000001',
      members: [],
      extra: true,
    }),
  ).not.toHaveProperty('extra');
  expect(() => parseSourceRecord('team', {})).toThrow();
});
