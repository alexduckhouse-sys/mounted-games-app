import type { CompetitionDetail, Heat, Race } from '../types';
import { sessionOrdinals, sessionTitle } from './timetableRows';

export interface ScoreCardRow {
  teamId: number;
  teamName: string;
  /** Running heat total after the race. */
  total: number;
  /** Points this race added. */
  added: number;
  eliminated: boolean;
  /** The team had no lane this race (more teams than lanes): shown as S, not +0. */
  sitOut?: boolean;
  /** Place on running total; tied teams share a place. */
  place: number;
  /** Movement since the previous race, or null for the first race or no change. */
  change: 'up' | 'down' | null;
}

export interface ScoreCard {
  heatId: number;
  raceId: number;
  raceName: string;
  /** 1-based position of the race in the heat. */
  raceNumber: number;
  raceCount: number;
  rows: ScoreCardRow[];
}

const byOrder = (a: Race, b: Race) => a.orderIndex - b.orderIndex;

function totals(races: Race[]): Map<number, number> {
  const sums = new Map<number, number>();
  for (const race of races) for (const result of race.results) sums.set(result.teamId, (sums.get(result.teamId) ?? 0) + result.points);
  return sums;
}

/** Shared places: one more than the number of teams strictly ahead. */
function places(teamIds: number[], sums: Map<number, number>): Map<number, number> {
  const scores = teamIds.map((id) => sums.get(id) ?? 0);
  return new Map(teamIds.map((id, i) => [id, 1 + scores.filter((score) => score > scores[i]).length]));
}

/** The whole heat table after `raceId`, ordered by running total, with what that race added. */
export function scoreCardFor(heat: Heat, raceId: number): ScoreCard | null {
  const races = [...heat.races].sort(byOrder);
  const index = races.findIndex((race) => race.id === raceId);
  if (index < 0 || !races[index].isComplete) return null;
  const race = races[index];
  const scored = races.slice(0, index + 1).filter((r) => r.isComplete);
  const after = totals(scored);
  const before = totals(scored.slice(0, -1));
  const teamIds = heat.entries.map((entry) => entry.teamId);
  const placeAfter = places(teamIds, after);
  const placeBefore = places(teamIds, before);
  const names = new Map(heat.entries.map((entry) => [entry.teamId, entry.teamName]));
  const results = new Map(race.results.map((result) => [result.teamId, result]));

  const rows = teamIds.map((teamId): ScoreCardRow => {
    const now = placeAfter.get(teamId)!;
    const was = placeBefore.get(teamId)!;
    return {
      teamId,
      teamName: names.get(teamId)!,
      total: after.get(teamId) ?? 0,
      added: results.get(teamId)?.points ?? 0,
      eliminated: results.get(teamId)?.eliminated ?? false,
      sitOut: results.get(teamId)?.isSitOut ?? false,
      place: now,
      change: scored.length < 2 || now === was ? null : now < was ? 'up' : 'down',
    };
  }).sort((a, b) => a.place - b.place || a.teamName.localeCompare(b.teamName));

  return { heatId: heat.id, raceId: race.id, raceName: race.name, raceNumber: index + 1, raceCount: races.length, rows };
}

const fingerprint = (race: Race) => `${race.isComplete}|${race.results.map((r) => `${r.teamId}:${r.points}:${r.eliminated}:${r.isSitOut ?? false}`).sort().join(',')}`;

/**
 * The race a results update has just scored: the latest complete race whose results differ from what the
 * phone had before. Null when nothing new was scored (a start time, a clear, or a repeat of the same update).
 */
export function newlyScoredRace(previous: Heat | undefined, next: Heat): number | null {
  const before = new Map(previous?.races.map((race) => [race.id, fingerprint(race)]) ?? []);
  const changed = [...next.races].sort(byOrder).filter((race) => race.isComplete && race.results.length > 0 && before.get(race.id) !== fingerprint(race));
  return changed.at(-1)?.id ?? null;
}

/** A card waiting to be shown over the video from one arena. */
export interface QueuedScoreCard {
  key: string;
  card: ScoreCard;
  /** The arena of the heat's session; empty when the session has none, so it shows on every stream. */
  arenaName: string;
  /** e.g. "Seniors Session 1 · Heat 2". */
  heading: string;
  /** When the results reached this phone (ms); the card shows `scoreCardDelaySeconds` later. */
  receivedAt: number;
  /** A producer's display changes: rows to leave out, names to show instead, and time on screen. */
  hiddenTeamIds?: number[];
  names?: Record<number, string>;
  seconds?: number | null;
}

/** A producer's instruction for one race's card, relayed to every viewer as `scoreCardControl`. */
export interface ScoreCardControl {
  heatId: number;
  raceId: number;
  action: 'show' | 'skip' | 'edit';
  hiddenTeamIds: number[];
  names: Record<number, string>;
  seconds: number | null;
}

/** Checks a relayed instruction before use; anything malformed is ignored. */
export function parseScoreCardControl(raw: unknown): ScoreCardControl | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.heatId !== 'number' || typeof c.raceId !== 'number' || !['show', 'skip', 'edit'].includes(c.action as string)) return null;
  const names: Record<number, string> = {};
  if (typeof c.names === 'object' && c.names !== null) {
    for (const [id, name] of Object.entries(c.names)) if (typeof name === 'string' && Number.isInteger(Number(id))) names[Number(id)] = name;
  }
  return {
    heatId: c.heatId, raceId: c.raceId, action: c.action as ScoreCardControl['action'],
    hiddenTeamIds: Array.isArray(c.hiddenTeamIds) ? c.hiddenTeamIds.filter((id): id is number => typeof id === 'number') : [],
    names, seconds: typeof c.seconds === 'number' ? c.seconds : null,
  };
}

/**
 * Applies a producer's instruction to the cards this phone holds: skip drops the card, show puts it on
 * screen now (whatever the delay), and edit changes its rows, names and time on screen.
 */
export function applyScoreCardControl(cards: QueuedScoreCard[], control: ScoreCardControl, now: number, delayMs: number): QueuedScoreCard[] {
  const matches = (c: QueuedScoreCard) => c.card.heatId === control.heatId && c.card.raceId === control.raceId;
  if (control.action === 'skip') return cards.filter((c) => !matches(c));
  return cards.map((c) => {
    if (!matches(c)) return c;
    if (control.action === 'show') return { ...c, receivedAt: now - delayMs };
    return { ...c, hiddenTeamIds: control.hiddenTeamIds, names: control.names, seconds: control.seconds };
  });
}

/** The card for a results update, if it scored a race this phone hadn't seen scored yet. */
export function queueScoreCard(competition: CompetitionDetail | null, sessionId: number, heat: Heat, receivedAt: number): QueuedScoreCard | null {
  const session = competition?.sessions.find((s) => s.id === sessionId);
  if (!competition || !session) return null;
  const previous = session.heats.find((h) => h.id === heat.id);
  const raceId = newlyScoredRace(previous, heat);
  const card = raceId == null ? null : scoreCardFor(heat, raceId);
  if (!card) return null;
  const ordered = [...session.heats].sort((a, b) => a.orderIndex - b.orderIndex);
  const heatNumber = (ordered.findIndex((h) => h.id === heat.id) + 1) || ordered.length + 1;
  return {
    key: `${heat.id}-${card.raceId}-${receivedAt}`,
    card,
    arenaName: session.arenaName?.trim() ?? '',
    heading: `${sessionTitle(session, sessionOrdinals(competition.sessions))} · ${heat.label || `Heat ${heatNumber}`}`,
    receivedAt,
  };
}
