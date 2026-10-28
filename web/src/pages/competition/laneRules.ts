import type { Heat, HeatEntry, Session } from '../../types';
import { LaneRotationMode, laneLabel, sitsOut, type LaneRotationModeValue } from '../../lib/lanes';
import type { PendingPlace } from '../../lib/raceScoring';

/** How many teams go through from each qualifier to the final. */
export const qualifiersOf = (session: Session): number => session.qualifiersPerHeat ?? 3;

/** How lanes change from race to race in this session, and how many lanes there are. */
export interface LaneRules { lanesPerHeat: number | null | undefined; mode: LaneRotationModeValue }

export const lanesOf = (session: Session): LaneRules => ({ lanesPerHeat: session.lanesPerHeat, mode: session.laneRotationMode ?? LaneRotationMode.MoveUp });

/** The heat's teams in drawn-lane order. Their place in this list is their starting position, as the server counts it. */
export const byDrawnLane = (heat: Heat): HeatEntry[] => heat.entries.slice().sort((a, b) => a.laneIndex - b.laneIndex || a.id - b.id);

/** What to show for a team's lane in a race: its lane number, or S while it sits out. */
export function displayLaneFor(heat: Heat, entry: HeatEntry, raceIndex: number, rules: LaneRules): string {
  const drawn = byDrawnLane(heat).findIndex((e) => e.id === entry.id) + 1;
  return laneLabel(drawn, raceIndex, heat.entries.length, rules.lanesPerHeat, rules.mode);
}

/** Whether the team has no lane in this race. */
export function sitsOutOf(heat: Heat, entry: HeatEntry, raceIndex: number, rules: LaneRules): boolean {
  const drawn = byDrawnLane(heat).findIndex((e) => e.id === entry.id) + 1;
  return sitsOut(drawn, raceIndex, heat.entries.length, rules.lanesPerHeat, rules.mode);
}

/** Qualifier teams nobody placed finish after those who were, in lane order, on the qualifier's 1 point. */
export function restOfQualifier(heat: Heat, placed: PendingPlace[]): PendingPlace[] {
  if (heat.raceRoundStage !== 1) return [];
  const done = new Set(placed.map((p) => p.teamId));
  let next = placed.filter((p) => !p.eliminated).length + 1;
  return byDrawnLane(heat).filter((e) => !done.has(e.teamId)).map((e) => ({ teamId: e.teamId, place: next++, eliminated: false }));
}

/** Teams with no lane this race still go in the result: no place, no points, shown as S. */
export function sitOutPlaces(heat: Heat, raceIndex: number, rules: LaneRules): PendingPlace[] {
  return heat.entries.filter((e) => sitsOutOf(heat, e, Math.max(raceIndex, 0), rules))
    .map((e) => ({ teamId: e.teamId, place: 0, eliminated: false }));
}
