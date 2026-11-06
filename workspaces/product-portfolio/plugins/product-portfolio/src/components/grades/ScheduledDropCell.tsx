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

import { Button, DialogTrigger, Flex, Popover, Text } from '@backstage/ui';
import type { ImageOccurrence } from '../../model/portfolioChi';
import { gradeCellStyle, gradeToneForId } from '../shared/gradeStyles';

type ScheduledDrop = ImageOccurrence['image']['futureDrops'][number];

const dropDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatDropDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dropDateFormatter.format(date);
}

function ScheduledDropBadge({ drop }: { drop: ScheduledDrop }) {
  const date = formatDropDate(drop.at);

  return (
    <Text
      as="span"
      variant="body-small"
      role="group"
      aria-label={`${date}: grade ${drop.from} drops to grade ${drop.to}`}
      style={{
        ...gradeCellStyle(gradeToneForId(drop.to.toLowerCase())),
        alignItems: 'center',
        alignSelf: 'flex-start',
        borderRadius: 4,
        display: 'inline-flex',
        fontVariantNumeric: 'tabular-nums',
        gap: '0.375rem',
        padding: '0.25rem 0.5rem',
        whiteSpace: 'nowrap',
      }}
    >
      <time dateTime={drop.at}>{date}</time>
      <Text as="strong" variant="body-small" weight="bold">
        {drop.from}
      </Text>
      <Text as="span" variant="body-small" aria-hidden="true">
        →
      </Text>
      <Text as="strong" variant="body-small" weight="bold">
        {drop.to}
      </Text>
    </Text>
  );
}

export function ScheduledDropCell({
  drops,
}: {
  drops: readonly ScheduledDrop[];
}) {
  const scheduledDrops = [...drops].sort(
    (first, second) => Date.parse(first.at) - Date.parse(second.at),
  );
  const nextDrop = scheduledDrops[0];

  if (!nextDrop) {
    return (
      <Text as="span" color="secondary">
        —
      </Text>
    );
  }

  const dropCount = `${scheduledDrops.length} scheduled drop${
    scheduledDrops.length === 1 ? '' : 's'
  }`;
  const nextDropStyle = gradeCellStyle(
    gradeToneForId(nextDrop.to.toLowerCase()),
  );

  return (
    <DialogTrigger>
      <Button
        variant="tertiary"
        size="small"
        aria-label={`Next scheduled drop ${formatDropDate(
          nextDrop.at,
        )}, grade ${nextDrop.from} to grade ${
          nextDrop.to
        }. Show all ${dropCount}`}
        style={{
          alignItems: 'center',
          backgroundColor: 'transparent',
          color: nextDropStyle.color,
          display: 'inline-flex',
          gap: '0.25rem',
          minHeight: 'auto',
          padding: '0.125rem 0.25rem',
          verticalAlign: 'middle',
        }}
      >
        <Flex align="center" gap="1">
          <ScheduledDropBadge drop={nextDrop} />
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            width="16"
            height="16"
            style={{ display: 'block', flexShrink: 0 }}
          >
            <path
              d="M4 6l4 4 4-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Flex>
      </Button>
      <Popover
        placement="bottom start"
        aria-label="Scheduled drops"
        style={{
          backgroundColor: 'var(--bui-bg-app)',
          border: '1px solid var(--bui-fg-secondary)',
          borderRadius: 8,
          boxShadow: '0 12px 28px rgba(0, 0, 0, 0.45)',
        }}
      >
        <Flex direction="column" gap="2" style={{ minWidth: '12rem' }}>
          <Text as="h3" variant="title-x-small">
            Scheduled drops
          </Text>
          {scheduledDrops.map((drop, index) => (
            <ScheduledDropBadge
              key={`${drop.at}-${drop.from}-${drop.to}-${index}`}
              drop={drop}
            />
          ))}
        </Flex>
      </Popover>
    </DialogTrigger>
  );
}
