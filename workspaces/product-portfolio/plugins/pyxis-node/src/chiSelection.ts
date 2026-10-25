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
  ChiSelectionIssue,
  ChiStreamSelection,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import type { ChiCandidate } from './ports';

const ARCHITECTURE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const ISSUE_ORDER: readonly ChiSelectionIssue[] = [
  'streams-not-configured',
  'no-published-candidate',
  'missing-expected-architecture',
  'invalid-architecture',
  'invalid-push-date',
  'invalid-tag-date',
  'conflicting-association',
  'tied-latest',
];

type SlotState = {
  maximum: string | null;
  ids: Set<string>;
  fingerprints: Map<string, string>;
  poison: ChiSelectionIssue | null;
};

type StreamState = {
  slots: Map<string, SlotState>;
  issues: Set<ChiSelectionIssue>;
  invalidArchitecture: boolean;
};

export interface ChiSelectionWinner {
  imageId: string;
  architecture: string;
  selectedIn: readonly string[];
  pushDates: Readonly<Record<string, string>>;
  fingerprints: Readonly<Record<string, string>>;
}

export interface ChiSelectionPlan {
  streams: readonly Omit<
    ChiStreamSelection,
    'counts' | 'worstKnownGrade' | 'earliestDrop'
  >[];
  winners: readonly ChiSelectionWinner[];
  issues: readonly ChiSelectionIssue[];
  complete: boolean;
}

export interface ChiSelectionOptions {
  registry: string;
  repository: string;
  streams: readonly string[];
  selectionAt: string;
  expectedArchitectures?: Readonly<Record<string, readonly string[]>>;
  maxStreams: number;
  maxArchitectureSlots: number;
}

const orderedIssues = (issues: Iterable<ChiSelectionIssue>) => {
  const set = new Set(issues);
  return ISSUE_ORDER.filter(issue => set.has(issue));
};

/** @internal */
export const timestamp = (value: string | null | undefined): string | null => {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  ) {
    return null;
  }

  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    return null;
  }

  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})/)!;
  const date = new Date(`${parts[1]}-${parts[2]}-${parts[3]}T00:00:00Z`);
  if (
    date.getUTCFullYear() !== Number(parts[1]) ||
    date.getUTCMonth() + 1 !== Number(parts[2]) ||
    date.getUTCDate() !== Number(parts[3])
  ) {
    return null;
  }

  return new Date(time).toISOString();
};

const fingerprint = (
  registry: string,
  repository: string,
  stream: string,
  architecture: string,
  pushDate: string,
) => JSON.stringify([registry, repository, stream, architecture, pushDate]);

/** Incremental, bounded latest-per-stream/architecture selector. @internal */
export class ChiSelectionAccumulator {
  private readonly streams = new Map<string, StreamState>();
  private slotCount = 0;

  constructor(private readonly options: ChiSelectionOptions) {
    if (
      options.streams.length > options.maxStreams ||
      new Set(options.streams).size !== options.streams.length
    ) {
      throw new Error('pyxis-chi-selection-limit');
    }
    for (const stream of options.streams) {
      this.streams.set(stream, {
        slots: new Map(),
        issues: new Set(),
        invalidArchitecture: false,
      });
    }
  }

  add(candidate: ChiCandidate): void {
    if (candidate.deleted === true) {
      return;
    }

    const architecture = candidate.architecture;
    const validArchitecture =
      typeof architecture === 'string' && ARCHITECTURE.test(architecture);

    for (const association of candidate.repositories) {
      if (
        association.registry !== this.options.registry ||
        association.repository !== this.options.repository ||
        association.published !== true
      ) {
        continue;
      }

      for (const tag of association.tags) {
        const state = this.streams.get(tag.name);
        if (
          !state ||
          (tag.removed_date !== null && tag.removed_date !== undefined)
        ) {
          continue;
        }

        if (!validArchitecture) {
          state.invalidArchitecture = true;
          state.issues.add('invalid-architecture');
          continue;
        }

        const slot = this.slot(state, architecture);
        const added = timestamp(tag.added_date);
        if (!added || added > this.options.selectionAt) {
          this.poison(state, slot, 'invalid-tag-date');
          continue;
        }

        const pushed = timestamp(association.push_date);
        if (!pushed || pushed > this.options.selectionAt) {
          this.poison(state, slot, 'invalid-push-date');
          continue;
        }

        const existing = slot.fingerprints.get(candidate._id);
        const currentFingerprint = fingerprint(
          association.registry,
          association.repository,
          tag.name,
          architecture,
          pushed,
        );
        if (existing && existing !== currentFingerprint) {
          this.poison(state, slot, 'conflicting-association');
          continue;
        }
        slot.fingerprints.set(candidate._id, currentFingerprint);

        if (slot.maximum === null || pushed > slot.maximum) {
          slot.maximum = pushed;
          slot.ids = new Set([candidate._id]);
        } else if (pushed === slot.maximum) {
          slot.ids.add(candidate._id);
        }
      }
    }
  }

  finish(): ChiSelectionPlan {
    const winners = new Map<
      string,
      {
        architecture: string;
        selectedIn: string[];
        pushDates: Record<string, string>;
        fingerprints: Record<string, string>;
      }
    >();
    const allIssues = new Set<ChiSelectionIssue>();
    const streams = [...this.streams.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([tag, state]) => {
        const expected = this.options.expectedArchitectures?.[tag];
        const observed = [...state.slots.keys()].sort();
        const missing = (expected ?? [])
          .filter(value => !state.slots.has(value))
          .sort();

        for (const architecture of missing) {
          if (!ARCHITECTURE.test(architecture)) {
            throw new Error('pyxis-chi-invalid-expected-architecture');
          }
          state.issues.add('missing-expected-architecture');
        }

        const slots: ChiSelectionPlan['streams'][number]['slots'][number][] = [
          ...observed.map(architecture => {
            const slot = state.slots.get(architecture)!;
            const tied = slot.ids.size > 1;
            const reason = state.invalidArchitecture
              ? 'invalid-architecture'
              : slot.poison ?? (tied ? 'tied-latest' : null);
            if (reason) {
              state.issues.add(reason);
            }

            const selected = !reason && slot.maximum && slot.ids.size === 1;
            const imageId = selected ? [...slot.ids][0] : null;

            if (imageId && slot.maximum) {
              const winner = winners.get(imageId) ?? {
                architecture,
                selectedIn: [],
                pushDates: {},
                fingerprints: {},
              };
              if (winner.architecture !== architecture) {
                throw new Error('pyxis-chi-selection-conflict');
              }

              winner.selectedIn.push(tag);
              winner.pushDates[tag] = slot.maximum;
              winner.fingerprints[tag] = slot.fingerprints.get(imageId)!;
              winners.set(imageId, winner);
            }

            return {
              architecture,
              state: selected ? ('selected' as const) : ('uncertain' as const),
              imageId,
              pushDate: selected ? slot.maximum : null,
              reason,
            };
          }),
          ...missing.map(architecture => ({
            architecture,
            state: 'missing' as const,
            imageId: null,
            pushDate: null,
            reason: 'missing-expected-architecture' as const,
          })),
        ].sort((left, right) =>
          left.architecture.localeCompare(right.architecture),
        );

        if (slots.length === 0 && !state.invalidArchitecture) {
          state.issues.add('no-published-candidate');
        }
        for (const issue of state.issues) {
          allIssues.add(issue);
        }

        return {
          tag,
          architectures: {
            basis: expected
              ? ('configured' as const)
              : ('observed-only' as const),
            expected: expected ? [...expected].sort() : null,
            observed,
            missing,
          },
          slots,
          issues: orderedIssues(state.issues),
        };
      });

    return {
      streams,
      winners: [...winners.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([imageId, winner]) => ({
          imageId,
          architecture: winner.architecture,
          selectedIn: winner.selectedIn.sort(),
          pushDates: Object.fromEntries(
            Object.entries(winner.pushDates).sort(([left], [right]) =>
              left.localeCompare(right),
            ),
          ),
          fingerprints: Object.fromEntries(
            Object.entries(winner.fingerprints).sort(([left], [right]) =>
              left.localeCompare(right),
            ),
          ),
        })),
      issues: orderedIssues(allIssues),
      complete: allIssues.size === 0,
    };
  }

  private slot(state: StreamState, architecture: string): SlotState {
    let slot = state.slots.get(architecture);

    if (!slot) {
      this.slotCount += 1;
      if (this.slotCount > this.options.maxArchitectureSlots) {
        throw new Error('pyxis-chi-selection-limit');
      }

      slot = {
        maximum: null,
        ids: new Set(),
        fingerprints: new Map(),
        poison: null,
      };
      state.slots.set(architecture, slot);
    }

    return slot;
  }

  private poison(
    state: StreamState,
    slot: SlotState,
    issue: ChiSelectionIssue,
  ): void {
    slot.poison = slot.poison ?? issue;
    state.issues.add(issue);
  }
}
