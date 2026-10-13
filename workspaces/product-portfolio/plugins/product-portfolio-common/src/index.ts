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

export interface SourceKey<K extends string = string> {
  sourceInstance: string;
  kind: K;
  id: string;
}

export interface Diagnostic {
  code: string;
  count?: number;
  operation?: string;
  stage?: string;
  retryable?: boolean;
  durationMs?: number;
}

/** Evidence of an observation, not an atomic upstream snapshot. @public */
export interface ReadMetadata {
  contractVersion: '1';
  startedAt: string;
  observedAt: string;
  sourceUpdatedAt?: string;
  traversal: {
    complete: boolean;
    atomic: false;
    pages: number;
    records: number;
  };
}

export type ReadEnvelope<T> = ReadMetadata &
  (
    | { state: 'complete'; data: T }
    | { state: 'partial'; data: T; diagnostics: readonly Diagnostic[] }
    | { state: 'unavailable'; diagnostics: readonly Diagnostic[] }
  );

export interface CatalogBinding {
  source: SourceKey;
  entityRef?: string;
  projectionVersion: '1';
  providerId: string;
  status: 'projected' | 'unresolved-owner' | 'invalid-source' | 'conflict';
}

export interface Association {
  target: SourceKey<'repository'>;
  entityRef?: string;
  provenance:
    | 'direct-listing'
    | 'source-inverse'
    | 'certification-derived'
    | 'connector-composition';
  status:
    | 'projected'
    | 'excluded-vendor'
    | 'admission-unresolved'
    | 'not-found'
    | 'projection-unresolved';
}

export interface AssociationSet {
  subject: SourceKey;
  authority: string;
  complete: boolean;
  associations: readonly Association[];
  diagnostics: readonly Diagnostic[];
}
