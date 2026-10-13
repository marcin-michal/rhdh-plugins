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

import type { Config } from '@backstage/config';
import { z } from 'zod';
import type { VendorPolicy } from '@red-hat-developer-hub/backstage-plugin-pyxis-common';

const sourceSchema = z
  .object({
    endpoint: z
      .string()
      .url()
      .refine(value => {
        const url = new URL(value);
        return (
          url.protocol === 'https:' &&
          !url.username &&
          !url.password &&
          !url.hash &&
          !url.search
        );
      }),
    certificateFile: z.string().min(1),
    keyFile: z.string().min(1),
    caFile: z.string().min(1).optional(),
    pageSize: z.number().int().min(1).max(500).default(100),
    concurrency: z.number().int().min(1).max(32).default(4),
    attemptTimeoutMs: z.number().int().positive().max(600000).default(30000),
    maxAttempts: z.number().int().min(1).max(10).default(3),
    maxPages: z.number().int().positive().max(10000).default(1000),
    maxRecords: z.number().int().positive().max(1000000).default(100000),
    maxResponseBytes: z
      .number()
      .int()
      .positive()
      .max(67108864)
      .default(16777216),
  })
  .strict();

const providerSchema = z
  .object({
    namespace: z.literal('pyxis').default('pyxis'),
    paused: z.boolean().default(false),
    vendorPolicy: z
      .enum(['redhat-only', 'redhat-or-unlabeled'])
      .default('redhat-only'),
    absenceDeletion: z
      .enum(['retain', 'confirmed-internal-404'])
      .default('retain'),
    internalNotFoundValidated: z.boolean().default(false),
    schedule: z
      .object({
        frequencySeconds: z.number().int().positive().default(3600),
        timeoutSeconds: z.number().int().positive().default(600),
        initialDelaySeconds: z.number().int().nonnegative().default(15),
      })
      .strict()
      .default({}),
  })
  .strict()
  .refine(
    value =>
      value.absenceDeletion === 'retain' || value.internalNotFoundValidated,
  );

/** Validated transport limits and mounted mTLS secret paths. @public */
export interface PyxisSourceConfig {
  endpoint: string;
  certificateFile: string;
  keyFile: string;
  caFile?: string;
  pageSize: number;
  concurrency: number;
  attemptTimeoutMs: number;
  maxAttempts: number;
  maxPages: number;
  maxRecords: number;
  maxResponseBytes: number;
}

/** Validated provider controls; pause preserves registration. @public */
export interface PyxisProviderConfig {
  namespace: 'pyxis';
  paused: boolean;
  vendorPolicy: VendorPolicy;
  absenceDeletion: 'retain' | 'confirmed-internal-404';
  internalNotFoundValidated: boolean;
  schedule: {
    frequencySeconds: number;
    timeoutSeconds: number;
    initialDelaySeconds: number;
  };
}

/** Reusable connection configuration is separate from ingestion controls. @public */
export interface PyxisConfiguration {
  sources: Record<string, PyxisSourceConfig>;
  providers: Record<string, PyxisProviderConfig>;
}

/** Validate before any network access or scheduling; never echo secret inputs. @public */
export function readPyxisConfig(config: Config): PyxisConfiguration {
  const sources: Record<string, PyxisSourceConfig> = {};
  const providers: Record<string, PyxisProviderConfig> = {};
  const sourceRoot = config.getOptionalConfig('pyxis.sources');

  for (const id of sourceRoot?.keys() ?? []) {
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(id)) {
      throw new Error('pyxis-invalid-source-instance');
    }

    const parsed = sourceSchema.safeParse(sourceRoot!.get(id));
    if (!parsed.success) {
      throw new Error('pyxis-invalid-source-configuration');
    }

    sources[id] = parsed.data;
  }

  const providerRoot = config.getOptionalConfig('catalog.providers.pyxis');
  for (const id of providerRoot?.keys() ?? []) {
    if (!Object.hasOwn(sources, id)) {
      throw new Error('pyxis-unknown-source-instance');
    }

    const parsed = providerSchema.safeParse(providerRoot!.get(id));
    if (!parsed.success) {
      throw new Error('pyxis-invalid-provider-configuration');
    }

    providers[id] = parsed.data;
  }

  return { sources, providers };
}
