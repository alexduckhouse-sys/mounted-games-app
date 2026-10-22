import type { Heat, Race } from '../types';

/** One team's place in the race being scored, before it is saved. */
export interface PendingPlace {
  teamId: number;
  place: number;
  eliminated: boolean;
}

/** Non-eliminated teams take places 1..n in order, with no gaps. Eliminated teams have no place (0). */
function renumber(list: PendingPlace[]): PendingPlace[] {
  let next = 0;
  return list.map((p) => (p.eliminated ? { ...p, place: 0 } : { ...p, place: ++next }));
}

function finishers(list: PendingPlace[]): number {
  return list.filter((p) => !p.eliminated).length;
}

/** Tap a team: it takes the next place, or drops out of the order if it already had one. */
export function tapTeam(list: PendingPlace[], teamId: number): PendingPlace[] {
  if (list.some((p) => p.teamId === teamId)) return renumber(list.filter((p) => p.teamId !== teamId));
  return [...list, { teamId, place: finishers(list) + 1, eliminated: false }];
}

/** Swipe a team out, or bring it back. A team brought back goes to the end of the order. */
export function toggleEliminated(list: PendingPlace[], teamId: number): PendingPlace[] {
  const existing = list.find((p) => p.teamId === teamId);
  if (!existing) return [...list, { teamId, place: 0, eliminated: true }];
  if (existing.eliminated) {
    const rest = list.filter((p) => p.teamId !== teamId);
    return [...rest, { teamId, place: finishers(rest) + 1, eliminated: false }];
  }
  return renumber(list.map((p) => (p.teamId === teamId ? { ...p, eliminated: true } : p)));
}

export interface RacePosition {
  heatId: number;
  raceId: number;
}

/**
 * The race to score after `current`. Heats run one after another (Heat 1 Race 1, Race 2, ... then
 * Heat 2 Race 1) unless the session alternates, which goes Heat 1 Race 1, Heat 2 Race 1, Heat 1 Race 2.
 * Races already scored or waiting to send are skipped. A race-finals session keeps to the current heat.
 * Returns null when nothing is left to score.
 */
export function nextRaceToScore(
  heats: Heat[],
  alternating: boolean,
  current: RacePosition,
  queuedRaceIds: ReadonlySet<number>,
): RacePosition | null {
  const raceFinals = heats.some((h) => (h.raceRoundStage ?? 0) !== 0);
  const ordered = (heat: Heat) => heat.races.slice().sort((a, b) => a.orderIndex - b.orderIndex);
  const open = (race: Race) => !race.isComplete && !queuedRaceIds.has(race.id) && race.id !== current.raceId;

  if (raceFinals) {
    const heat = heats.find((h) => h.id === current.heatId);
    const race = heat ? ordered(heat).find(open) : undefined;
    return race ? { heatId: current.heatId, raceId: race.id } : null;
  }

  const scorable = heats.filter((h) => h.entries.length > 0 || h.id === current.heatId);
  const slots: RacePosition[] = [];
  const racesById = new Map<number, Race>();
  if (alternating) {
    const rows = scorable.map((h) => ({ heat: h, races: ordered(h) }));
    const longest = rows.reduce((m, r) => Math.max(m, r.races.length), 0);
    for (let i = 0; i < longest; i++) {
      for (const { heat, races } of rows) {
        if (races[i]) { slots.push({ heatId: heat.id, raceId: races[i].id }); racesById.set(races[i].id, races[i]); }
      }
    }
  } else {
    for (const heat of scorable) {
      for (const race of ordered(heat)) { slots.push({ heatId: heat.id, raceId: race.id }); racesById.set(race.id, race); }
    }
  }

  const at = slots.findIndex((s) => s.raceId === current.raceId);
  const following = [...slots.slice(at + 1), ...slots.slice(0, Math.max(at, 0))];
  return following.find((s) => open(racesById.get(s.raceId)!)) ?? null;
}
