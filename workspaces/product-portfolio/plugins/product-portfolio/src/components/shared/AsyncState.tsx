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

import type { ReactNode } from 'react';
import { Button, Text } from '@backstage/ui';
import { Progress } from '@backstage/core-components';
import type { RelatedState } from '../../hooks/useRelatedEntities';
import { QualityNotice } from './QualityNotice';

export function AsyncState({
  state,
  children,
  empty = 'No related catalog entities.',
}: {
  state: RelatedState;
  children: ReactNode;
  empty?: string;
}) {
  if (state.loading)
    return (
      <div role="status" aria-label="Loading related catalog data">
        <Progress />
      </div>
    );

  if (state.error)
    return (
      <>
        <QualityNotice error message={state.error} />
        <Button onPress={state.retry}>Retry</Button>
      </>
    );

  return (
    <>
      {state.partial && (
        <QualityNotice message="Some related catalog data is unavailable." />
      )}
      {state.entities.length ? children : <Text as="p">{empty}</Text>}
    </>
  );
}
