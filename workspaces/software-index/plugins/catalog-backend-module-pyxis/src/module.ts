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

import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { catalogProcessingExtensionPoint } from '@backstage/plugin-catalog-node';
import {
  PyxisClient,
  RepositoryChiReader,
  readPyxisConfig,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-node';
import { CatalogInventory } from './catalogInventory';
import { PyxisChiProcessor, type PyxisChiRuntime } from './chiProcessor';
import { PyxisProvider } from './provider';
import { PyxisRelationshipProcessor } from './processor';

/** @public */
export const catalogModulePyxis = createBackendModule({
  pluginId: 'catalog',
  moduleId: 'pyxis',
  register(reg) {
    reg.registerInit({
      deps: {
        catalog: catalogProcessingExtensionPoint,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
        scheduler: coreServices.scheduler,
        auth: coreServices.auth,
        discovery: coreServices.discovery,
        lifecycle: coreServices.lifecycle,
      },
      async init({
        catalog,
        config,
        logger,
        scheduler,
        auth,
        discovery,
        lifecycle,
      }) {
        const settings = readPyxisConfig(config);
        const providers: PyxisProvider[] = [];
        const clients: PyxisClient[] = [];
        const chiRuntimes: Record<string, PyxisChiRuntime> = {};
        const shutdown = new AbortController();

        lifecycle.addShutdownHook(async () => {
          shutdown.abort();
          await Promise.all([
            ...providers.map(provider => provider.close()),
            ...clients.map(client => client.close()),
          ]);
        });

        try {
          for (const [sourceInstance, providerConfig] of Object.entries(
            settings.providers,
          )) {
            const sourceConfig = settings.sources[sourceInstance];
            const client = await PyxisClient.create(
              sourceConfig,
              sourceInstance,
            );
            clients.push(client);

            chiRuntimes[sourceInstance] = {
              reader: new RepositoryChiReader(
                sourceInstance,
                client,
                sourceConfig,
                providerConfig.chi,
                providerConfig.vendorPolicy,
              ),
              chi: providerConfig.chi,
              provider: providerConfig,
            };

            providers.push(
              new PyxisProvider(
                sourceInstance,
                sourceConfig,
                providerConfig,
                client,
                new CatalogInventory(discovery, auth),
                scheduler,
                logger,
              ),
            );
          }
        } catch (error) {
          shutdown.abort();
          await Promise.all([
            ...providers.map(provider => provider.close()),
            ...clients.map(client => client.close()),
          ]);
          throw error;
        }

        catalog.addEntityProvider(...providers);
        catalog.addProcessor(new PyxisRelationshipProcessor());
        catalog.addProcessor(
          new PyxisChiProcessor(chiRuntimes, shutdown.signal),
        );
      },
    });
  },
});
