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
import { metrics } from '@opentelemetry/api';
import {
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  AggregationTemporality,
} from '@opentelemetry/sdk-metrics';
import { mockServices } from '@backstage/backend-test-utils';
import { CatalogInventory } from './catalogInventory';
import { PyxisProvider } from './provider';
import { fixtureClient, settings } from './testSupport';

describe('observability observability', () => {
  it('collects real counters, durations and quality gauges with bounded attributes', async () => {
    metrics.disable();
    const exporter = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE,
    );
    const reader = new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 60000,
    });
    const meterProvider = new MeterProvider({ readers: [reader] });
    metrics.setGlobalMeterProvider(meterProvider);
    const client = fixtureClient();
    const catalog = new CatalogInventory(
      mockServices.discovery(),
      mockServices.auth(),
    );

    jest.spyOn(catalog, 'read').mockResolvedValue([]);
    jest.spyOn(catalog, 'assertNoConflicts').mockResolvedValue();

    const logger = mockServices.logger.mock();
    const provider = new PyxisProvider(
      'internal',
      settings.sources.internal,
      settings.providers.internal,
      client,
      catalog,
      mockServices.scheduler.mock(),
      logger,
    );

    await provider.connect({
      applyMutation: async () => {},
      refresh: async () => {},
    });
    await provider.run();
    jest
      .mocked(client.listListings)
      .mockRejectedValueOnce(
        new Error('secret upstream detail employee@example.test'),
      );
    await provider.run();

    const collected = await reader.collect();
    const points = collected.resourceMetrics.scopeMetrics.flatMap(
      scope => scope.metrics,
    );

    expect(
      points
        .find(metric => metric.descriptor.name === 'pyxis.syncs')
        ?.dataPoints.map(point => point.value),
    ).toEqual([1, 1]);
    expect(
      points
        .find(metric => metric.descriptor.name === 'pyxis.inventory.records')
        ?.dataPoints.some(
          point =>
            point.attributes.outcome === 'submitted' && point.value === 9,
        ),
    ).toBe(true);
    expect(
      points.find(metric => metric.descriptor.name === 'pyxis.sync.duration'),
    ).toBeDefined();
    expect(
      points.find(
        metric => metric.descriptor.name === 'pyxis.sync.last_success',
      ),
    ).toBeDefined();

    for (const metric of points)
      for (const point of metric.dataPoints)
        expect(
          Object.keys(point.attributes).every(key =>
            ['sourceInstance', 'kind', 'outcome', 'reason'].includes(key),
          ),
        ).toBe(true);

    expect(JSON.stringify([collected, logger.warn.mock.calls])).not.toMatch(
      /secret upstream|employee@example|person-A/,
    );

    await provider.close();
    await meterProvider.shutdown();
    metrics.disable();
  });
});
