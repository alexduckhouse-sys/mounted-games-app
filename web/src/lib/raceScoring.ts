import type { Heat, Race } from '../types';
import { RESULT_STATUS, effectiveStatus } from './resultStatus';

/** One team's place in the race being scored, before it is saved. */
export interface PendingPlace {
  teamId: number;
  place: number;
  eliminated: boolean;
  /** Why the team did not finish (see `resultStatus.ts`). Left out for a plain elimination, which is what the server assumes. */
  status?: number;
  /** A private note for staff. Left out to keep the note already saved; an empty string clears it. */
  refereeNote?: string;
}

/** Store manual points in the same private directive the scoring API and offline outbox accept. */
export function overridePoints(list: PendingPlace[], teamId: number, points: number | undefined, reason?: string): PendingPlace[] {
  const existing = list.find((p) => p.teamId === teamId);
  if (points === undefined && !existing) return list;
  const note = (existing?.refereeNote ?? '').replace(/\[(?:pts|adj):[^\]]*\]/gi, '').trim();
  const refereeNote = points === undefined ? note : `[pts:${points}] ${reason?.trim() || note || 'Manual score override'}`;
  const place = existing?.place || Math.max(0, ...list.map((p) => p.place)) + 1;
  const replacement: PendingPlace = points === undefined
    ? { ...existing!, refereeNote }
    : { teamId, place, eliminated: false, refereeNote };
  if (points !== undefined && existing?.eliminated) return [...list.filter((p) => p.teamId !== teamId), replacement];
  return existing ? list.map((p) => p.teamId === teamId ? replacement : p) : [...list, replacement];
}

export function manualPoints(note?: string): number | undefined {
  const value = /\[pts:(\d+(?:\.\d+)?)\]/i.exec(note ?? '')?.[1];
  const points = value === undefined ? undefined : Number(value);
  return points !== undefined && Number.isFinite(points) && Number.isInteger(points * 2) ? points : undefined;
}

/** Non-eliminated teams take places 1..n in order, with no gaps. Eliminated teams have no place (0). */
function renumber(list: PendingPlace[]): PendingPlace[] {
  let next = 0;
  return list.map((p) => (p.eliminated ? { ...p, place: 0 } : { ...p, place: ++next }));
}

/** The team as a finisher in `place`: it keeps its note but no longer has a reason for not finishing. */
function finisher(p: PendingPlace, place: number): PendingPlace {
  const rest = { ...p, place, eliminated: false };
  delete rest.status;
  return rest;
}

function finishers(list: PendingPlace[]): number {
  return list.filter((p) => !p.eliminated).length;
}

/**
 * Tap a team: it takes the next place, or drops out of the order if it already had one.
 * In a qualifier only `qualifierCap` teams are placed; once they are, tapping another team eliminates it.
 */
export function tapTeam(list: PendingPlace[], teamId: number, qualifierCap: number | null = null): PendingPlace[] {
  if (list.some((p) => p.teamId === teamId)) return renumber(list.filter((p) => p.teamId !== teamId));
  if (qualifierCap != null && finishers(list) >= qualifierCap) return [...list, { teamId, place: 0, eliminated: true }];
  return [...list, { teamId, place: finishers(list) + 1, eliminated: false }];
}

/** Eliminating a team resets manual points while retaining its plain-language note. */
function withoutManualPoints(p: PendingPlace): PendingPlace {
  return p.refereeNote === undefined ? p : { ...p, refereeNote: p.refereeNote.replace(/\[(?:pts|adj):[^\]]*\]/gi, '').trim() };
}

/** Swipe a team out, or bring it back. A team brought back goes to the end of the order. */
export function toggleEliminated(list: PendingPlace[], teamId: number): PendingPlace[] {
  const existing = list.find((p) => p.teamId === teamId);
  if (!existing) return [...list, { teamId, place: 0, eliminated: true }];
  if (existing.eliminated) {
    const rest = list.filter((p) => p.teamId !== teamId);
    return [...rest, finisher(existing, finishers(rest) + 1)];
  }
  return renumber(list.map((p) => (p.teamId === teamId ? { ...withoutManualPoints(p), eliminated: true } : p)));
}

/**
 * Give a team that did not finish its reason (E, DNS, DNF or R), putting it in the list if it isn't there.
 * Finished (0) brings an out team back to the end of the order, the same as swiping it back in.
 */
export function setStatus(list: PendingPlace[], teamId: number, status: number): PendingPlace[] {
  const existing = list.find((p) => p.teamId === teamId);
  if (status === RESULT_STATUS.Finished) return existing?.eliminated ? toggleEliminated(list, teamId) : list;
  if (!existing) return [...list, { teamId, place: 0, eliminated: true, status }];
  return renumber(list.map((p) => (p.teamId === teamId ? { ...withoutManualPoints(p), eliminated: true, status } : p)));
}

/** Set a team's private note. A team with no place or reason yet has nothing to attach it to, so it is left alone. */
export function setNote(list: PendingPlace[], teamId: number, note: string): PendingPlace[] {
  return list.map((p) => (p.teamId === teamId ? { ...p, refereeNote: note } : p));
}

/**
 * The placings already saved for a race, as the scorer would have entered them. Teams sitting the race out are
 * left out. `notes` are the private notes staff have saved (from the staff-only score read), by team.
 */
export function placesFromResults(race: Race, notes: Readonly<Record<number, string>> = {}): PendingPlace[] {
  return race.results
    .filter((r) => !r.isSitOut)
    .sort((a, b) => (a.placing ?? 999) - (b.placing ?? 999))
    .map((r, i): PendingPlace => ({
      teamId: r.teamId,
      place: r.eliminated ? 0 : r.placing ?? i + 1,
      eliminated: r.eliminated,
      ...(r.eliminated ? { status: effectiveStatus(true, r.status) } : {}),
      ...(notes[r.teamId] ? { refereeNote: notes[r.teamId] } : {}),
    }));
}

/** Where a race's unsaved placings are kept on this phone, so a reload doesn't lose them. */
export function scoringDraftKey(heatId: number, raceId: number): string {
  return `mg.draft.scoring:${heatId}:${raceId}`;
}

function isPendingPlace(value: unknown): value is PendingPlace {
  const p = value as PendingPlace | null;
  return typeof p === 'object' && p !== null
    && Number.isInteger(p.teamId) && Number.isInteger(p.place) && typeof p.eliminated === 'boolean'
    && (p.status === undefined || Number.isInteger(p.status))
    && (p.refereeNote === undefined || typeof p.refereeNote === 'string');
}

/** The saved draft under `key`, or null when there is none or it can't be read. */
export function readScoringDraft(key: string): PendingPlace[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 && parsed.every(isPendingPlace) ? parsed : null;
  } catch {
    return null;
  }
}

/** Keep `places` as the draft under `key`; an empty list removes it. */
export function writeScoringDraft(key: string, places: PendingPlace[]): void {
  try {
    if (places.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(places));
  } catch { /* storage full or blocked: the draft is a convenience */ }
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
