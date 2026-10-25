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

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  ChiAttention,
  ChiCounts,
  ChiDrop,
  ChiGrade,
  ChiImageMetadata,
  ChiImageObservation,
  ChiPeriod,
  ChiStreamSelection,
  RepositoryChiSnapshot,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import type { ChiSelectionPlan, ChiSelectionWinner } from './chiSelection';

const gradeOrder: Record<ChiGrade, number> = {
  A: 0,
  B: 1,
  C: 2,
  D: 3,
  E: 4,
  F: 5,
};

const rawPeriodSchema = z.object({
  grade: z.enum(['A', 'B', 'C', 'D', 'E', 'F']),
  start_date: z.string(),
  end_date: z.string().nullable().optional(),
  creation_date: z.string().nullable().optional(),
});

const rfc3339 = (value: string): string | null => {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  ) {
    return null;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const date = new Date(parsed);
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})/)!;
  const probe = new Date(`${parts[1]}-${parts[2]}-${parts[3]}T00:00:00Z`);
  if (
    probe.getUTCFullYear() !== Number(parts[1]) ||
    probe.getUTCMonth() + 1 !== Number(parts[2]) ||
    probe.getUTCDate() !== Number(parts[3])
  ) {
    return null;
  }

  return date.toISOString();
};

/** @internal */
export const emptyChiCounts = (): ChiCounts => ({
  total: 0,
  byGrade: { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, unknown: 0 },
  aWithScheduledDrop: 0,
  byAttention: { ok: 0, warning: 0, problem: 0, unknown: 0 },
});

/** @public */
export function countChiImages(
  images: readonly ChiImageObservation[],
): ChiCounts {
  const counts = emptyChiCounts();
  const unique = new Map(images.map(image => [image.imageId, image]));
  counts.total = unique.size;

  for (const image of unique.values()) {
    if (image.currentGrade) {
      counts.byGrade[image.currentGrade] += 1;
    } else {
      counts.byGrade.unknown += 1;
    }

    counts.byAttention[image.attention] += 1;
    if (image.currentGrade === 'A' && image.futureDrops.length > 0) {
      counts.aWithScheduledDrop += 1;
    }
  }

  return counts;
}

const attentionFor = (
  grade: ChiGrade | null,
  futureDrops: readonly ChiDrop[],
): ChiAttention => {
  if (!grade) {
    return 'unknown';
  }

  if (grade === 'A') {
    return futureDrops.length > 0 ? 'warning' : 'ok';
  }

  if (grade === 'B' || grade === 'C') {
    return 'warning';
  }

  return 'problem';
};

const inconsistentImage = (
  winner: ChiSelectionWinner & ChiImageMetadata,
): ChiImageObservation => ({
  imageId: winner.imageId,
  architecture: winner.architecture,
  selectedIn: winner.selectedIn,
  pushDates: winner.pushDates,
  activeTags: winner.activeTags,
  manifestDigest: winner.manifestDigest,
  manifestListDigest: winner.manifestListDigest,
  publishedAt: winner.publishedAt,
  currentGrade: null,
  gradeOrigin: 'normalized-source-periods',
  gradeQuality: 'inconsistent',
  periodEvidence: 'inconsistent',
  periods: [],
  futureDrops: [],
  attention: 'unknown',
});

/** Normalize source periods and evaluate them at one fixed clock. @internal */
export function normalizeChiImage(
  winner: ChiSelectionWinner & ChiImageMetadata,
  raw: unknown,
  observedAt: string,
  hidden: boolean,
  maxPeriods: number,
): ChiImageObservation {
  if (hidden) {
    return {
      ...inconsistentImage(winner),
      gradeQuality: 'hidden',
      periodEvidence: 'hidden',
    };
  }

  if (
    raw === null ||
    raw === undefined ||
    (Array.isArray(raw) && raw.length === 0)
  ) {
    return {
      ...inconsistentImage(winner),
      gradeQuality: 'unknown',
      periodEvidence: 'absent',
    };
  }

  if (!Array.isArray(raw)) {
    return inconsistentImage(winner);
  }

  if (raw.length > maxPeriods) {
    throw new Error('pyxis-chi-period-limit');
  }

  const periods: ChiPeriod[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    const parsed = rawPeriodSchema.safeParse(value);
    if (!parsed.success) {
      return inconsistentImage(winner);
    }

    const startAt = rfc3339(parsed.data.start_date);
    const endAt = parsed.data.end_date ? rfc3339(parsed.data.end_date) : null;
    const createdAt = parsed.data.creation_date
      ? rfc3339(parsed.data.creation_date)
      : null;

    if (
      !startAt ||
      (parsed.data.end_date && !endAt) ||
      (parsed.data.creation_date && !createdAt) ||
      (endAt && endAt <= startAt)
    ) {
      return inconsistentImage(winner);
    }

    const period = { grade: parsed.data.grade, startAt, endAt, createdAt };
    const key = JSON.stringify(period);

    if (!seen.has(key)) {
      seen.add(key);
      periods.push(period);
    }
  }

  periods.sort(
    (left, right) =>
      left.startAt.localeCompare(right.startAt) ||
      (left.endAt ?? '\uffff').localeCompare(right.endAt ?? '\uffff') ||
      left.grade.localeCompare(right.grade) ||
      (left.createdAt ?? '').localeCompare(right.createdAt ?? ''),
  );

  for (let index = 0; index < periods.length; index += 1) {
    for (let other = index + 1; other < periods.length; other += 1) {
      if (
        periods[index].endAt !== null &&
        periods[other].startAt >= periods[index].endAt!
      ) {
        break;
      }
      if (periods[index].grade !== periods[other].grade) {
        return inconsistentImage(winner);
      }
    }
  }

  const current = periods.find(
    period =>
      period.startAt <= observedAt &&
      (period.endAt === null || observedAt < period.endAt),
  );

  const futureDrops: ChiDrop[] = [];
  for (const from of periods) {
    if (!from.endAt || from.endAt <= observedAt) continue;

    for (const to of periods) {
      if (
        to.startAt === from.endAt &&
        gradeOrder[to.grade] > gradeOrder[from.grade]
      ) {
        futureDrops.push({ from: from.grade, to: to.grade, at: to.startAt });
      }
    }
  }

  futureDrops.sort(
    (left, right) =>
      left.at.localeCompare(right.at) ||
      left.from.localeCompare(right.from) ||
      left.to.localeCompare(right.to),
  );

  return {
    imageId: winner.imageId,
    architecture: winner.architecture,
    selectedIn: winner.selectedIn,
    pushDates: winner.pushDates,
    activeTags: winner.activeTags,
    manifestDigest: winner.manifestDigest,
    manifestListDigest: winner.manifestListDigest,
    publishedAt: winner.publishedAt,
    currentGrade: current?.grade ?? null,
    gradeOrigin: 'normalized-source-periods',
    gradeQuality: current ? 'known' : 'unknown',
    periodEvidence: 'valid',
    periods,
    futureDrops,
    attention: attentionFor(current?.grade ?? null, futureDrops),
  };
}

/** Attach grade/count summaries to the pure selection result. @internal */
export function summarizeChiStreams(
  plan: ChiSelectionPlan,
  images: readonly ChiImageObservation[],
): ChiStreamSelection[] {
  const byId = new Map(images.map(image => [image.imageId, image]));

  return plan.streams.map(stream => {
    const selected = [
      ...new Set(
        stream.slots
          .map(slot => slot.imageId)
          .filter((value): value is string => value !== null),
      ),
    ]
      .map(imageId => byId.get(imageId))
      .filter((value): value is ChiImageObservation => value !== undefined);

    const known = selected
      .filter(image => image.currentGrade !== null)
      .sort(
        (left, right) =>
          gradeOrder[right.currentGrade!] - gradeOrder[left.currentGrade!],
      );

    const drops = selected
      .flatMap(image =>
        image.futureDrops.map(drop => ({
          ...drop,
          imageId: image.imageId,
          architecture: image.architecture,
        })),
      )
      .sort(
        (left, right) =>
          left.at.localeCompare(right.at) ||
          left.imageId.localeCompare(right.imageId) ||
          left.architecture.localeCompare(right.architecture),
      );

    return {
      ...stream,
      counts: countChiImages(selected),
      worstKnownGrade: known[0]?.currentGrade ?? null,
      earliestDrop: drops[0] ?? null,
    };
  });
}

const canonicalEvidence = (snapshot: RepositoryChiSnapshot) => ({
  normalizationVersion: snapshot.normalizationVersion,
  population: snapshot.population,
  source: snapshot.source,
  locator: snapshot.locator,
  streamPolicy: snapshot.streamPolicy,
  hiddenUntil: snapshot.hiddenUntil,
  published: snapshot.published,
  streams: snapshot.streams.map(stream => ({
    tag: stream.tag,
    architectures: stream.architectures,
    slots: stream.slots,
    issues: stream.issues,
  })),
  issues: snapshot.issues,
  images: snapshot.images.map(image => ({
    imageId: image.imageId,
    architecture: image.architecture,
    selectedIn: image.selectedIn,
    pushDates: image.pushDates,
    activeTags: image.activeTags,
    manifestDigest: image.manifestDigest,
    manifestListDigest: image.manifestListDigest,
    publishedAt: image.publishedAt,
    periods: image.periods,
    periodEvidence: image.periodEvidence,
  })),
});

/** Stable evidence hash excluding clocks and evaluation-derived values. @public */
export function hashChiSnapshotEvidence(
  snapshot: RepositoryChiSnapshot,
): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalEvidence(snapshot)))
    .digest('hex');
}
