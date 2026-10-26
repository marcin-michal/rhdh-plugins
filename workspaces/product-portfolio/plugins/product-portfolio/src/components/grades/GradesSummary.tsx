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
  Cell,
  Flex,
  Table,
  Text,
  type ColumnConfig,
  type TableItem,
  useTable,
} from '@backstage/ui';
import type { RelatedState } from '../../hooks/useRelatedEntities';
import { aggregatePortfolioChi } from '../../model/portfolioChi';
import { readEntity } from '../../model/entities';
import { AsyncState } from '../shared/AsyncState';
import { ChiObservationMetadata } from '../shared/ChiObservationMetadata';
import { DetailCard } from '../shared/DetailCard';
import {
  gradeCellStyle,
  gradeToneForId,
  type GradeTone,
} from '../shared/gradeStyles';

interface GradeRow extends TableItem {
  label: string;
  count: number;
  tone: GradeTone;
}

const gradeColumns: ColumnConfig<GradeRow>[] = [
  {
    id: 'grade',
    label: 'Grade',
    width: '3fr',
    isRowHeader: true,
    cell: row => <Cell style={gradeCellStyle(row.tone)}>{row.label}</Cell>,
  },
  {
    id: 'count',
    label: 'Images',
    width: '1fr',
    cell: row => (
      <Cell
        style={{
          ...gradeCellStyle(row.tone),
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {row.count.toLocaleString()}
      </Cell>
    ),
  },
];

export function GradesSummary({
  state,
  entityHref,
}: {
  state: RelatedState;
  entityHref?: string;
}) {
  const repositories = state.entities.filter(
    entity => readEntity(entity).value?.category === 'repository',
  );
  const { aggregate, snapshotsUsed, latestObservationAt } =
    aggregatePortfolioChi(repositories, Date.now());
  const counts = aggregate.counts;
  const gradeRows: GradeRow[] = [
    {
      id: 'a',
      label: 'A',
      count: Math.max(0, counts.byGrade.A - counts.aWithScheduledDrop),
      tone: gradeToneForId('a'),
    },
    {
      id: 'a-with-drop',
      label: 'A with drop',
      count: counts.aWithScheduledDrop,
      tone: gradeToneForId('a-with-drop'),
    },
    ...(['B', 'C', 'D', 'E', 'F'] as const).map(
      (grade): GradeRow => ({
        id: grade.toLowerCase(),
        label: grade,
        count: counts.byGrade[grade],
        tone: gradeToneForId(grade.toLowerCase()),
      }),
    ),
  ];
  const rows = gradeRows.filter(row => row.count > 0);
  const { tableProps } = useTable({
    mode: 'complete',
    data: rows,
    paginationOptions: { type: 'none' },
  });

  return (
    <DetailCard title="Grades">
      <Flex direction="column" gap="4">
        <ChiObservationMetadata
          state={state}
          repositoryCount={repositories.length}
          summary={{ aggregate, snapshotsUsed, latestObservationAt }}
          showObservationStatus={false}
        />

        <AsyncState
          state={state}
          empty="No repository observations available."
          showPartialWarning={false}
        >
          <Flex direction="column" gap="3">
            {rows.length ? (
              <Table
                {...tableProps}
                columnConfig={gradeColumns}
                rowConfig={{
                  getHref: row =>
                    entityHref
                      ? `${entityHref}/grades?grade=${row.id}`
                      : undefined,
                }}
              />
            ) : (
              <Text as="p" color="secondary">
                No images with a known grade are available.
              </Text>
            )}
          </Flex>
        </AsyncState>
      </Flex>
    </DetailCard>
  );
}
