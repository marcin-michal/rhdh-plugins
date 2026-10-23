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

import type { PortfolioEntity } from './entities';

export type PublicationState =
  | 'published'
  | 'unpublished'
  | 'deleted'
  | 'unknown'
  | 'not-applicable';
export function publicationState(model: PortfolioEntity): PublicationState {
  if (model.category === 'team' || model.category === 'user') {
    return 'not-applicable';
  }

  const record = model.projection.record;
  if (
    model.category === 'listing' &&
    record &&
    'deleted' in record &&
    record.deleted === true
  ) {
    return 'deleted';
  }

  if (record && 'published' in record) {
    if (record.published === true) {
      return 'published';
    }

    if (record.published === false) {
      return 'unpublished';
    }
  }

  return 'unknown';
}
