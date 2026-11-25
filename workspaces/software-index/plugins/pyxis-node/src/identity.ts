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

import type { HostIdentityBindingResolver } from './ports';
import { checkRead } from './client';

/** Default host binding exposes the absent authority without guessing a join. @public */
export const unmatchedHostIdentityResolver: HostIdentityBindingResolver = {
  async resolve(users, options) {
    checkRead(options);
    const observedAt = new Date().toISOString();
    return {
      contractVersion: '1',
      startedAt: observedAt,
      observedAt,
      traversal: {
        complete: true,
        atomic: false,
        pages: 0,
        records: users.length,
      },
      state: 'complete',
      data: users.map(source => ({
        source,
        state: 'unmatched',
        authority: 'mapping-authority-unconfigured',
        version: '1',
        observedAt,
      })),
    };
  },
};
