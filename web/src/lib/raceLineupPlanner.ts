// Unused in web UI yet — reserved for iOS / upcoming race-lineup UI wiring
import type { Race, RiderEntry, RiderRaceRole, SectionFormat } from '../types';
import { publicRiderName } from './riderNames';

export interface RaceLineupWarning {
  kind: 'too-few-riders' | 'too-many-riders' | 'unbalanced-sit-outs';
  raceKey?: string;
  riderKey?: string;
  message: string;
}

export interface RiderRideSummary {
  riderKey: string;
  riderName: string;
  isReserve: boolean;
  ridesCount: number;
  sitOutsCount: number;
}

/** Stable key for a rider in the lineup plan. Uses `publicRiderName` when `id` is absent so `useInitialOnly` minors never expose their surname in lineup keys. */
export function riderLineupKey(rider: Pick<RiderEntry, 'id' | 'fullName'> & { useInitialOnly?: boolean }): string {
  return rider.id > 0
    ? String(rider.id)
    : publicRiderName({ fullName: rider.fullName, useInitialOnly: Boolean(rider.useInitialOnly) });
}

/** Stable key for a race inside a heat in the lineup plan. */
export function raceLineupKey(heatId: number, race: Pick<Race, 'id' | 'orderIndex'>): string {
  return race.id > 0 ? String(race.id) : `${heatId}:${race.orderIndex}`;
}

/** Required active riders per race for a section format (4 for Teams, 2 for Pairs, 1 for Individual). */
export function requiredRidersForFormat(format: SectionFormat | number | null | undefined): number {
  if (format === 1) return 2;
  if (format === 3) return 1;
  return 4;
}

/** Cycles a rider's assignment through legs `1`..`requiredRiders` and `'sit-out'`. */
export function cycleRiderRaceRole(
  current: RiderRaceRole | string | undefined,
  requiredRiders: number = 4,
): RiderRaceRole {
  const roles: RiderRaceRole[] =
    requiredRiders === 2
      ? ['1', '2', 'sit-out']
      : requiredRiders === 1
        ? ['1', 'sit-out']
        : ['1', '2', '3', '4', 'sit-out'];
  const idx = roles.indexOf((current as RiderRaceRole) ?? 'sit-out');
  return roles[(idx + 1) % roles.length];
}

/**
 * Sets a specific rider to `'sit-out'` for a race and assigns legs `'1'`..`'4'` in order to the remaining riders.
 * In a 5-rider team where 4 ride and 1 sits out, tapping who sits out each race automatically assigns legs 1–4.
 */
export function assignSitOutRiderForRace(
  riders: readonly Pick<RiderEntry, 'id' | 'fullName' | 'isReserve'>[],
  sitOutRiderKey: string,
  requiredRiders: number = 4,
): Record<string, RiderRaceRole> {
  const row: Record<string, RiderRaceRole> = {};
  const availableNonReserves = riders.filter(
    (r) => !r.isReserve && riderLineupKey(r) !== sitOutRiderKey,
  ).length;
  const keepReservesOut = availableNonReserves >= requiredRiders;
  let leg = 1;
  for (const rider of riders) {
    const key = riderLineupKey(rider);
    if (key === sitOutRiderKey || leg > requiredRiders || (keepReservesOut && rider.isReserve)) {
      row[key] = 'sit-out';
    } else {
      row[key] = String(leg) as RiderRaceRole;
      leg++;
    }
  }
  return row;
}

/**
 * Auto-rotates sit-out assignments across all races in a heat so each core rider sits out an even number of times,
 * while reserves sit out by default unless needed to reach `requiredRiders`.
 */
export function buildAutoRotatedHeatLineup(
  heatId: number,
  races: readonly Pick<Race, 'id' | 'orderIndex' | 'name'>[],
  riders: readonly Pick<RiderEntry, 'id' | 'fullName' | 'isReserve'>[],
  requiredRiders: number = 4,
): Record<string, Record<string, RiderRaceRole>> {
  const result: Record<string, Record<string, RiderRaceRole>> = {};
  if (riders.length === 0 || races.length === 0) return result;

  const coreRiders = riders.filter((r) => !r.isReserve);
  const pool = coreRiders.length >= requiredRiders ? coreRiders : riders;

  races.forEach((race, raceIndex) => {
    const rKey = raceLineupKey(heatId, race);
    if (pool.length <= requiredRiders) {
      const row: Record<string, RiderRaceRole> = {};
      let leg = 1;
      for (const rider of riders) {
        const key = riderLineupKey(rider);
        if (leg <= requiredRiders && (!rider.isReserve || pool.length === riders.length)) {
          row[key] = String(leg++) as RiderRaceRole;
        } else {
          row[key] = 'sit-out';
        }
      }
      result[rKey] = row;
      return;
    }

    // Rotate who sits out from the back of the core pool first (rider 5 in Race 1, rider 4 in Race 2, etc.)
    const sitOutIdx = (pool.length - 1 - (raceIndex % pool.length) + pool.length) % pool.length;
    const sitOutKey = riderLineupKey(pool[sitOutIdx]);
    result[rKey] = assignSitOutRiderForRace(riders, sitOutKey, requiredRiders);
  });

  return result;
}

/** Summarises how many races each rider rides vs sits out in a heat. */
export function summarizeRiderRideCounts(
  heatId: number,
  races: readonly Pick<Race, 'id' | 'orderIndex'>[],
  riders: readonly Pick<RiderEntry, 'id' | 'fullName' | 'isReserve'>[],
  assignments: Record<string, Record<string, RiderRaceRole | string>>,
): RiderRideSummary[] {
  return riders.map((rider) => {
    const rKey = riderLineupKey(rider);
    let ridesCount = 0;
    let sitOutsCount = 0;
    for (const race of races) {
      const key = raceLineupKey(heatId, race);
      const role = assignments[key]?.[rKey];
      if (!role) continue;
      if (role === 'sit-out') {
        sitOutsCount++;
      } else {
        ridesCount++;
      }
    }
    return {
      riderKey: rKey,
      riderName: rider.fullName,
      isReserve: rider.isReserve,
      ridesCount,
      sitOutsCount,
    };
  });
}

/**
 * Validates a heat's race lineup and returns warnings if:
 * - Fewer than `requiredRiders` (e.g. 4) riders are assigned to any planned race
 * - More than `requiredRiders` riders are assigned to any planned race
 * - A core rider is accidentally left sitting out too many times compared to teammates
 */
export function validateHeatLineup(
  heatId: number,
  races: readonly Pick<Race, 'id' | 'orderIndex' | 'name'>[],
  riders: readonly Pick<RiderEntry, 'id' | 'fullName' | 'isReserve'>[],
  assignments: Record<string, Record<string, RiderRaceRole | string>>,
  requiredRiders: number = 4,
): RaceLineupWarning[] {
  const warnings: RaceLineupWarning[] = [];
  if (riders.length === 0 || races.length === 0) return warnings;

  for (let i = 0; i < races.length; i++) {
    const race = races[i];
    const rKey = raceLineupKey(heatId, race);
    const racePlan = assignments[rKey];
    if (!racePlan || Object.keys(racePlan).length === 0) continue;

    let activeCount = 0;
    for (const rider of riders) {
      const role = racePlan[riderLineupKey(rider)];
      if (role && role !== 'sit-out') activeCount++;
    }

    const raceLabel = `Race ${race.orderIndex || i + 1}: ${race.name}`;
    if (activeCount < Math.min(requiredRiders, riders.length)) {
      warnings.push({
        kind: 'too-few-riders',
        raceKey: rKey,
        message: `${raceLabel} has only ${activeCount} of ${requiredRiders} riders assigned.`,
      });
    } else if (activeCount > requiredRiders) {
      warnings.push({
        kind: 'too-many-riders',
        raceKey: rKey,
        message: `${raceLabel} has ${activeCount} riders assigned (maximum ${requiredRiders}).`,
      });
    }
  }

  const summaries = summarizeRiderRideCounts(heatId, races, riders, assignments);
  const coreSummaries = summaries.filter((s) => !s.isReserve && s.ridesCount + s.sitOutsCount > 0);
  if (coreSummaries.length > requiredRiders) {
    const minSitOuts = Math.min(...coreSummaries.map((s) => s.sitOutsCount));
    for (const summary of coreSummaries) {
      if (summary.sitOutsCount - minSitOuts >= 2) {
        warnings.push({
          kind: 'unbalanced-sit-outs',
          riderKey: summary.riderKey,
          message: `${summary.riderName} sits out ${summary.sitOutsCount} races while another rider sits out ${minSitOuts}.`,
        });
      }
    }
  }

  return warnings;
}
