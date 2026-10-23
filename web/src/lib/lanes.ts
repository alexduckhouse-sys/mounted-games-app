/**
 * Which lane a team races in from one race of a heat to the next, and which teams have no lane (sit out).
 * A team's drawn lane is its starting position; each race the positions shift by the session's rotation.
 * When a heat has more teams than the session has lanes, positions past the last lane sit that race out.
 * Keep in step with `api/Services/LaneRotation.cs`.
 */

/** Stored as a number by the API. Moving up is 0 because it is what every session did before this was a choice. */
export const LaneRotationMode = { MoveUp: 0, Stay: 1, MoveDown: 2 } as const;
export type LaneRotationModeValue = (typeof LaneRotationMode)[keyof typeof LaneRotationMode];

export const LANE_ROTATION_LABELS: Record<LaneRotationModeValue, string> = {
  0: 'Move up one lane',
  1: 'Stay in the drawn lane',
  2: 'Move down one lane',
};

/** The lanes in use: the session's lane limit, or one per team when there is no limit. */
export function lanesInUse(teamsInHeat: number, lanesPerHeat?: number | null): number {
  const teams = Math.max(teamsInHeat, 1);
  return lanesPerHeat && lanesPerHeat > 0 ? Math.min(lanesPerHeat, teams) : teams;
}

/** The position a team holds in a race (0 is the first), counted from 1 among all teams in the heat. */
export function positionFor(drawnLane: number, raceIndex: number, teamsInHeat: number, mode: LaneRotationModeValue = 0): number {
  if (teamsInHeat <= 0) return drawnLane;
  const step = mode === 0 ? 1 : mode === 2 ? -1 : 0;
  const shifted = (((drawnLane - 1 + step * raceIndex) % teamsInHeat) + teamsInHeat) % teamsInHeat;
  return shifted + 1;
}

/** True when the team has no lane in this race: its position is past the last lane in use. */
export function sitsOut(drawnLane: number, raceIndex: number, teamsInHeat: number, lanesPerHeat: number | null | undefined, mode: LaneRotationModeValue = 0): boolean {
  return positionFor(drawnLane, raceIndex, teamsInHeat, mode) > lanesInUse(teamsInHeat, lanesPerHeat);
}

/** What to show for a team's lane in a race: its lane number, or "S" while it sits out. */
export function laneLabel(drawnLane: number, raceIndex: number, teamsInHeat: number, lanesPerHeat: number | null | undefined, mode: LaneRotationModeValue = 0): string {
  return sitsOut(drawnLane, raceIndex, teamsInHeat, lanesPerHeat, mode)
    ? 'S'
    : String(positionFor(drawnLane, raceIndex, teamsInHeat, mode));
}
