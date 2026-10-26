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

import { Flex, Link, Text } from '@backstage/ui';
import { DetailRow } from './DetailRow';

export interface ContactListItem {
  email_address?: string | null;
  type?: string | null;
}

export function ContactList({
  contacts,
  emptyMessage,
}: {
  contacts: readonly ContactListItem[];
  emptyMessage: string;
}) {
  if (contacts.length === 0) {
    return (
      <Text as="p" color="secondary">
        {emptyMessage}
      </Text>
    );
  }

  return (
    <Flex direction="column" gap="3">
      {contacts.map((contact, index) => {
        const type = contact.type?.trim() || 'Contact';
        const email = contact.email_address?.trim();

        return (
          <DetailRow key={`${type}:${email ?? ''}:${index}`} label={type}>
            {email ? (
              <Link href={`mailto:${email}`}>{email}</Link>
            ) : (
              <Text as="span" color="secondary">
                Email address not available.
              </Text>
            )}
          </DetailRow>
        );
      })}
    </Flex>
  );
}
