import type { CompetitionDetail, Heat, HeatEntry, Race } from '../types';
import { hatbandFor, inLaneOrder } from './laneOrder';
import { hatbandName } from './hatbands';
import { ordinal } from './toplist';
import { statusLabel } from './resultStatus';
import { displayLaneFor, lanesOf, sitsOutOf, type LaneRules } from '../pages/competition/laneRules';
import type { PendingPlace } from './raceScoring';

/**
 * One race's lanes the way the scorer shows them, so the commentary desk and the stream overlays say the same
 * thing: the rotated lane for that race, S for a team sitting out, and the hatband of the lane it actually rides in.
 */
export interface RaceLane {
  entry: HeatEntry;
  /** "1", "2"... or "S" while the team sits out. */
  lane: string;
  sitting: boolean;
  /** The stored hatband for that lane; null while sitting out or when the event sets none. */
  hatband: string | null;
}

/** The heat's races in running order. */
export function racesInOrder(heat: Heat): Race[] {
  return heat.races.slice().sort((a, b) => a.orderIndex - b.orderIndex);
}

/** The race being run or up next in a heat: the first one not complete, or null once all are done (or there are none). */
export function currentRaceIndex(heat: Heat): number | null {
  const index = racesInOrder(heat).findIndex((race) => !race.isComplete);
  return index >= 0 ? index : null;
}

export function raceLanes(heat: Heat, raceIndex: number, rules: LaneRules, hatbands: string[] | null | undefined): RaceLane[] {
  const index = Math.max(raceIndex, 0);
  return inLaneOrder(heat, index, rules).map((entry) => {
    const sitting = sitsOutOf(heat, entry, index, rules);
    const lane = displayLaneFor(heat, entry, index, rules);
    return { entry, lane, sitting, hatband: sitting ? null : hatbandFor(hatbands, lane) };
  });
}

/**
 * A heat's lanes for the race being run (or the first race before any are run), worked out the way the scorer does,
 * so the stream says the same lane and hatband as the scoring screen. Null when the heat's session can't be found.
 */
export function currentLanes(competition: Pick<CompetitionDetail, 'sessions' | 'laneHatbands'>, heat: Heat): { lanes: RaceLane[]; raceName: string | null } | null {
  const session = competition.sessions.find((s) => s.heats.some((h) => h.id === heat.id));
  if (!session) return null;
  const index = currentRaceIndex(heat) ?? 0;
  return { lanes: raceLanes(heat, index, lanesOf(session), competition.laneHatbands), raceName: racesInOrder(heat)[index]?.name ?? null };
}

/** What to call a lane in words: its hatband ("Red") when the event sets them, else "Lane 3", or "Sits out". */
export function laneWords(lane: Pick<RaceLane, 'lane' | 'sitting' | 'hatband'>): string {
  if (lane.sitting) return 'Sits out';
  const name = lane.hatband ? hatbandName(lane.hatband) : '';
  return name || `Lane ${lane.lane}`;
}

export interface ReviewLine {
  teamId: number;
  /** "Red · Test A · 1st". */
  text: string;
  out: boolean;
}

/**
 * The finishing order to check before saving: placed teams by place (teams sharing a place stay in lane order),
 * then teams that are out. Each line names the lane's hatband, the team and the result. Sit-outs and teams not
 * scored yet are left out. Points are not worked out here.
 */
export function finishingReview(lanes: RaceLane[], pending: readonly PendingPlace[], hcTeamIds: ReadonlySet<number>): ReviewLine[] {
  const byTeam = new Map(pending.map((place) => [place.teamId, place]));
  const scored: { lane: RaceLane; order: number; state: PendingPlace }[] = [];
  lanes.forEach((lane, order) => {
    const state = byTeam.get(lane.entry.teamId);
    if (!lane.sitting && state && (state.eliminated || state.place > 0)) scored.push({ lane, order, state });
  });
  const rank = (state: PendingPlace) => (state.eliminated ? Number.MAX_SAFE_INTEGER : state.place);
  scored.sort((a, b) => rank(a.state) - rank(b.state) || a.order - b.order);
  return scored.map(({ lane, state }) => {
    // A team that is out always has a status label ("Eliminated" for older saves with none).
    const result = state.eliminated
      ? statusLabel(true, state.status)
      : `${ordinal(state.place)}${hcTeamIds.has(lane.entry.teamId) ? ' (HC)' : ''}`;
    return { teamId: lane.entry.teamId, text: `${laneWords(lane)} · ${lane.entry.teamName} · ${result}`, out: state.eliminated };
  });
}

/**
 * The one racing team still to be placed or put out, when exactly one of two or more is left; otherwise null.
 * `doneByHand` holds teams whose points were set by hand, which count as scored.
 */
export function lastLaneLeft(lanes: RaceLane[], pending: readonly PendingPlace[], doneByHand: ReadonlySet<number> = new Set()): number | null {
  const byTeam = new Map(pending.map((place) => [place.teamId, place]));
  const racing = lanes.filter((lane) => !lane.sitting);
  if (racing.length < 2) return null;
  const left = racing.filter((lane) => {
    const state = byTeam.get(lane.entry.teamId);
    return !(state?.eliminated || (state?.place ?? 0) > 0 || doneByHand.has(lane.entry.teamId));
  });
  return left.length === 1 ? left[0].entry.teamId : null;
}
