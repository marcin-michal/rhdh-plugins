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

import { useId, type ReactNode } from 'react';
import { Card, CardBody, Flex, Text } from '@backstage/ui';

export function DetailCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const titleId = useId();

  return (
    <Card aria-labelledby={titleId}>
      <CardBody>
        <Flex direction="column" gap="3">
          <Text as="h2" id={titleId} variant="title-small" weight="bold">
            {title}
          </Text>
          {children}
        </Flex>
      </CardBody>
    </Card>
  );
}
