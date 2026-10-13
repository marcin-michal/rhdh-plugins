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

export interface Config {
  pyxis?: {
    /** @visibility backend */
    sources?: {
      [sourceInstance: string]: {
        endpoint: string;
        /** @visibility secret */
        certificateFile: string;
        /** @visibility secret */
        keyFile: string;
        /** @visibility secret */
        caFile?: string;
        pageSize?: number;
        concurrency?: number;
        attemptTimeoutMs?: number;
        maxAttempts?: number;
        maxPages?: number;
        maxRecords?: number;
        maxResponseBytes?: number;
      };
    };
  };
  catalog?: {
    providers?: {
      /** @visibility backend */
      pyxis?: {
        [sourceInstance: string]: {
          namespace?: 'pyxis';
          paused?: boolean;
          /** Exact redhat only by default; broad mode also admits null or missing labels. */
          vendorPolicy?: 'redhat-only' | 'redhat-or-unlabeled';
          absenceDeletion?: 'retain' | 'confirmed-internal-404';
          internalNotFoundValidated?: boolean;
          schedule?: {
            frequencySeconds?: number;
            timeoutSeconds?: number;
            initialDelaySeconds?: number;
          };
        };
      };
    };
  };
}
