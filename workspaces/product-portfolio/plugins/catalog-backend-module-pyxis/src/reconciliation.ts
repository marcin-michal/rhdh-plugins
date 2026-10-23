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

import type { EntityProviderMutation } from '@backstage/plugin-catalog-node';
import { isDeepStrictEqual } from 'node:util';
import type { ReadEnvelope } from '@red-hat-developer-hub/backstage-plugin-product-portfolio-common';
import type {
  InventorySnapshot,
  PyxisProjection,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-common';
import {
  sourceRef,
  type PyxisProviderConfig,
} from '@red-hat-developer-hub/backstage-plugin-pyxis-node';
import { parseProjection, projectEntity, providerId } from './projection';

export interface ReconciliationPlan {
  mutation?: EntityProviderMutation;
  retained: number;
  projections: PyxisProjection[];
}

/** Scan timing is evidence about a read, not provider-owned entity content. */
function providerOwnedContent(projection: PyxisProjection) {
  const { observation: _observation, roster, ...content } = projection;

  if (!roster) {
    return content;
  }

  const { observedAt: _observedAt, ...stableRoster } = roster;
  return { ...content, roster: stableRoster };
}

function hasSameProviderContent(
  previous: PyxisProjection,
  next: PyxisProjection,
): boolean {
  return isDeepStrictEqual(
    providerOwnedContent(previous),
    providerOwnedContent(next),
  );
}

/** Incomplete required reads cannot produce any mutation. */
export function planMutation(
  sourceInstance: string,
  prior: readonly PyxisProjection[],
  scan: ReadEnvelope<InventorySnapshot>,
  config: Pick<
    PyxisProviderConfig,
    'absenceDeletion' | 'internalNotFoundValidated'
  >,
): ReconciliationPlan {
  if (
    scan.state === 'unavailable' ||
    !scan.traversal.complete ||
    scan.data.quality.fetch !== 'complete'
  ) {
    return { retained: prior.length, projections: [...prior] };
  }

  const locationKey = providerId(sourceInstance);
  const previous = new Map(prior.map(p => [sourceRef(p.source), p]));
  const next = new Map(previous);
  const removed = new Set<string>();
  const updated = new Set<string>();
  const addedEntities = new Map<string, ReturnType<typeof projectEntity>>();
  const observation = {
    contractVersion: scan.contractVersion,
    startedAt: scan.startedAt,
    observedAt: scan.observedAt,
    traversal: scan.traversal,
  };

  const add = (p: PyxisProjection) => {
    const ref = sourceRef(p.source);
    const entity = projectEntity(p);
    const candidate = parseProjection(entity.spec?.pyxis);
    const previousProjection = previous.get(ref);

    if (
      previousProjection &&
      hasSameProviderContent(previousProjection, candidate)
    ) {
      next.set(ref, previousProjection);
      updated.delete(ref);
      addedEntities.delete(ref);
    } else {
      next.set(ref, candidate);
      updated.add(ref);
      addedEntities.set(ref, entity);
    }

    removed.delete(ref);
  };

  const remove = (ref: string) => {
    if (previous.has(ref)) {
      next.delete(ref);
      updated.delete(ref);
      addedEntities.delete(ref);
      removed.add(ref);
    }
  };

  for (const resource of [...scan.data.listings, ...scan.data.repositories]) {
    const ref = sourceRef(resource.source);
    const deleted =
      resource.source.kind === 'listing' &&
      'deleted' in resource.record &&
      resource.record.deleted === true;
    if (deleted || resource.vendor.decision === 'exclude') {
      remove(ref);
      continue;
    }

    if (
      resource.vendor.decision !== 'admit' ||
      resource.binding.status !== 'projected' ||
      (resource.associations &&
        !resource.associations.complete &&
        previous.has(ref))
    ) {
      continue;
    }

    add({
      version: '1',
      source: resource.source,
      observation,
      record: resource.record,
      vendor: resource.vendor,
      ownership: resource.ownership,
      ...(resource.associations ? { associations: resource.associations } : {}),
    });
  }

  const completeTeams = new Set<string>();
  for (const team of scan.data.teams) {
    if (team.roster.completeness !== 'complete') {
      continue;
    }

    completeTeams.add(sourceRef(team.roster.team));
    add({
      version: '1',
      source: team.roster.team,
      record: team.record,
      roster: team.roster,
      observation,
    });
  }

  if (
    config.absenceDeletion === 'confirmed-internal-404' &&
    config.internalNotFoundValidated
  ) {
    for (const key of scan.data.notFound) {
      if (
        key.kind === 'listing' ||
        key.kind === 'repository' ||
        key.kind === 'team'
      ) {
        const ref = sourceRef({ ...key, kind: key.kind });
        remove(ref);
        if (key.kind === 'team') {
          completeTeams.add(ref);
        }
      }
    }
  }

  const users = new Map<string, PyxisProjection>();
  // Only unresolved contributions retain old memberships. Complete teams may remove them.
  for (const previousUser of prior.filter(p => p.source.kind === 'user')) {
    users.set(sourceRef(previousUser.source), {
      ...previousUser,
      memberships: previousUser.memberships!.filter(
        member => !completeTeams.has(sourceRef(member.team)),
      ),
      observation,
    });
  }

  for (const group of next.values()) {
    if (group.source.kind !== 'team') {
      continue;
    }

    for (const member of group.roster!.members) {
      const ref = sourceRef(member.user);
      const user = users.get(ref) ?? {
        version: '1',
        source: member.user,
        observation,
        memberships: [],
      };
      const memberships = user.memberships!.filter(
        m => sourceRef(m.team) !== sourceRef(group.source),
      );

      memberships.push({
        team: { ...group.source, kind: 'team' },
        ...(member.role ? { role: member.role } : {}),
        ...(member.addedDate ? { addedDate: member.addedDate } : {}),
      });
      user.memberships = memberships.sort((a, b) =>
        sourceRef(a.team).localeCompare(sourceRef(b.team)),
      );
      users.set(ref, user);
    }
  }

  for (const [ref, user] of users) {
    if (user.memberships!.length) {
      add(user);
    } else {
      remove(ref);
    }
  }

  const projections = [...next.values()];

  return {
    retained: [...previous.keys()].filter(
      ref => !updated.has(ref) && !removed.has(ref),
    ).length,
    projections,
    mutation: {
      type: 'delta',
      added: projections
        .filter(p => updated.has(sourceRef(p.source)))
        .map(p => ({
          entity: addedEntities.get(sourceRef(p.source))!,
          locationKey,
        })),
      removed: [...removed].map(entityRef => ({ entityRef, locationKey })),
    },
  };
}
