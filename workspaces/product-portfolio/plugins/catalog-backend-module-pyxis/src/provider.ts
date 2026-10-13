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

import type {
  LoggerService,
  SchedulerService,
} from '@backstage/backend-plugin-api';
import type {
  EntityProvider,
  EntityProviderConnection,
} from '@backstage/plugin-catalog-node';
import { metrics } from '@opentelemetry/api';
import type { Diagnostic } from '@red-hat-developer-hub/backstage-plugin-product-portfolio-common';
import {
  checkRead,
  PyxisInventoryReader,
  type PyxisReadClient,
  type PyxisSourceConfig,
  type PyxisProviderConfig,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-node';
import { CatalogInventory } from './catalogInventory';
import { providerId } from './projection';
import { planMutation } from './reconciliation';

type InventoryScan = Awaited<ReturnType<PyxisInventoryReader['scan']>>;

const SAFE_DIAGNOSTIC_CODES = new Set([
  'cancelled',
  'deadline',
  'transport',
  'http',
  'authorization',
  'graphql',
  'source',
  'validation',
  'limit',
  'pagination',
  'inventory-failed',
]);
const SAFE_DIAGNOSTIC_STAGES = new Set([
  'listings',
  'repositories',
  'limits',
  'tracked-listing',
  'tracked-repository',
  'relationships',
  'teams',
  'finalize',
]);
const SAFE_DIAGNOSTIC_OPERATIONS = new Set(['inventory-scan']);
const MAX_DIAGNOSTIC_COUNTER = 1_000_000;
const MAX_DIAGNOSTIC_DURATION_MS = 86_400_000;

function boundedNumber(value: unknown, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(0, Math.trunc(value)))
    : 0;
}

function safeScanDiagnostic(scan: InventoryScan) {
  const diagnostic: Diagnostic | undefined =
    scan.state === 'complete' ? undefined : scan.diagnostics[0];
  const fallbackDuration =
    Date.parse(scan.observedAt) - Date.parse(scan.startedAt);
  const code =
    diagnostic?.code && SAFE_DIAGNOSTIC_CODES.has(diagnostic.code)
      ? diagnostic.code
      : 'unknown';
  const stage =
    diagnostic?.stage && SAFE_DIAGNOSTIC_STAGES.has(diagnostic.stage)
      ? diagnostic.stage
      : 'unknown';
  const operation =
    diagnostic?.operation &&
    SAFE_DIAGNOSTIC_OPERATIONS.has(diagnostic.operation)
      ? diagnostic.operation
      : 'inventory-scan';

  return {
    code,
    operation,
    stage,
    pages: boundedNumber(scan.traversal.pages, MAX_DIAGNOSTIC_COUNTER),
    records: boundedNumber(scan.traversal.records, MAX_DIAGNOSTIC_COUNTER),
    retryable: diagnostic?.retryable === true,
    durationMs: boundedNumber(
      diagnostic?.durationMs ?? fallbackDuration,
      MAX_DIAGNOSTIC_DURATION_MS,
    ),
  };
}

export class PyxisProvider implements EntityProvider {
  private connection?: EntityProviderConnection;
  private readonly shutdown = new AbortController();
  private running?: Promise<void>;
  private readonly meter = metrics.getMeter('pyxis-consumer', '1');
  private readonly syncs = this.meter.createCounter('pyxis.syncs');
  private readonly duration = this.meter.createHistogram(
    'pyxis.sync.duration',
    { unit: 's' },
  );
  private readonly counts = this.meter.createGauge('pyxis.inventory.records');
  private readonly quality = this.meter.createGauge(
    'pyxis.inventory.coverage_gap',
  );
  private readonly lastSuccess = this.meter.createGauge(
    'pyxis.sync.last_success',
    { unit: 's' },
  );

  constructor(
    private readonly sourceInstance: string,
    private readonly sourceConfig: PyxisSourceConfig,
    private readonly config: PyxisProviderConfig,
    private readonly client: PyxisReadClient,
    private readonly catalog: CatalogInventory,
    private readonly scheduler: SchedulerService,
    private readonly logger: LoggerService,
  ) {}

  getProviderName(): string {
    return providerId(this.sourceInstance);
  }

  async connect(connection: EntityProviderConnection): Promise<void> {
    if (this.connection) {
      throw new Error('pyxis-already-connected');
    }

    this.connection = connection;
    const schedule = this.config.schedule;

    await this.scheduler.scheduleTask({
      id: this.getProviderName(),
      scope: 'global',
      frequency: { seconds: schedule.frequencySeconds },
      timeout: { seconds: schedule.timeoutSeconds },
      initialDelay: { seconds: schedule.initialDelaySeconds },
      signal: this.shutdown.signal,
      fn: signal => this.run(signal),
    });
  }

  async close(): Promise<void> {
    this.shutdown.abort();
    await this.client.close();
    await this.running;
  }

  async run(signal?: AbortSignal): Promise<void> {
    if (this.config.paused) {
      return;
    }

    if (!this.connection) {
      throw new Error('pyxis-not-connected');
    }

    if (this.running) {
      await this.running;
      return;
    }

    this.running = this.synchronize(signal).finally(() => {
      this.running = undefined;
    });

    await this.running;
  }

  private async synchronize(signal?: AbortSignal): Promise<void> {
    const started = Date.now();
    const options = {
      signal: AbortSignal.any([
        this.shutdown.signal,
        ...(signal ? [signal] : []),
      ]),
      deadline: started + this.config.schedule.timeoutSeconds * 1000,
    };
    let outcome = 'failed';
    let submitted = false;

    try {
      const prior = await this.catalog.read(this.sourceInstance, options);
      const inventory = new PyxisInventoryReader(
        this.sourceInstance,
        this.client,
        this.sourceConfig,
        prior.flatMap(p => [
          p.source,
          ...(p.memberships?.map(m => m.team) ?? []),
        ]),
        this.config.vendorPolicy,
      );
      const scan = await inventory.scan(options);
      const plan = planMutation(this.sourceInstance, prior, scan, this.config);

      if (!plan.mutation) {
        this.logger.warn('Pyxis scan incomplete; inventory retained', {
          sourceInstance: this.sourceInstance,
          code: 'incomplete-scan',
          diagnostic: safeScanDiagnostic(scan),
        });
        return;
      }

      await this.catalog.assertNoConflicts(
        this.sourceInstance,
        plan.projections,
        options,
      );

      checkRead(options);
      submitted = true;
      await this.connection!.applyMutation(plan.mutation);
      outcome = 'submitted';

      this.lastSuccess.record(Date.now() / 1000, {
        sourceInstance: this.sourceInstance,
      });
      this.counts.record(plan.retained, {
        sourceInstance: this.sourceInstance,
        outcome: 'retained',
      });
      this.counts.record(
        plan.mutation.type === 'delta' ? plan.mutation.removed.length : 0,
        { sourceInstance: this.sourceInstance, outcome: 'removed' },
      );
      this.counts.record(plan.projections.length, {
        sourceInstance: this.sourceInstance,
        outcome: 'submitted',
      });
      this.counts.record(
        plan.projections.filter(p => p.source.kind === 'user').length,
        {
          sourceInstance: this.sourceInstance,
          kind: 'user',
          outcome: 'binding-unmatched',
        },
      );

      if (scan.state !== 'unavailable') {
        const resources = [...scan.data.listings, ...scan.data.repositories];
        for (const ownership of [
          'resolved-id',
          'unresolved-opaque',
          'unresolved-owner',
        ] as const) {
          this.counts.record(
            resources.filter(record => record.ownership === ownership).length,
            {
              sourceInstance: this.sourceInstance,
              kind: 'ownership',
              outcome: ownership,
            },
          );
        }

        for (const completeness of [
          'complete',
          'partial',
          'unavailable',
        ] as const) {
          this.counts.record(
            scan.data.teams.filter(
              team => team.roster.completeness === completeness,
            ).length,
            {
              sourceInstance: this.sourceInstance,
              kind: 'roster',
              outcome: completeness,
            },
          );
        }

        const associations = scan.data.listings.flatMap(
          listing => listing.associations?.associations ?? [],
        );

        for (const status of [
          'projected',
          'excluded-vendor',
          'admission-unresolved',
          'not-found',
          'projection-unresolved',
        ] as const) {
          this.counts.record(
            associations.filter(association => association.status === status)
              .length,
            {
              sourceInstance: this.sourceInstance,
              kind: 'association',
              outcome: status,
            },
          );
        }

        for (const [reason, state] of Object.entries(scan.data.quality)) {
          this.quality.record(state === 'complete' ? 0 : 1, {
            sourceInstance: this.sourceInstance,
            reason,
          });
        }

        for (const kind of ['listings', 'repositories'] as const) {
          for (const decision of ['admit', 'exclude', 'unresolved'] as const) {
            this.counts.record(
              scan.data[kind].filter(item => item.vendor.decision === decision)
                .length,
              { sourceInstance: this.sourceInstance, kind, outcome: decision },
            );
          }
        }
      }

      this.logger.info('Pyxis catalog delta submitted', {
        sourceInstance: this.sourceInstance,
        submitted: plan.projections.length,
        retained: plan.retained,
      });
    } catch {
      outcome = options.signal.aborted ? 'cancelled' : 'failed';
      if (submitted) {
        outcome = 'outcome-unknown';
      }

      this.logger.warn('Pyxis synchronization did not acknowledge success', {
        sourceInstance: this.sourceInstance,
        code: outcome,
      });
    } finally {
      this.syncs.add(1, { sourceInstance: this.sourceInstance, outcome });
      this.duration.record((Date.now() - started) / 1000, {
        sourceInstance: this.sourceInstance,
        outcome,
      });
    }
  }
}
