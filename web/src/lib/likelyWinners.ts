import type { Session, Team } from '../types';

/**
 * "Favourites" for the stream: the teams in an age group most likely to finish near the top, from two things:
 *
 * - **this event**: the team's average placing in the races it has ridden so far (race places, 1 is best);
 * - **history**: how it has finished in earlier finished competitions, as the average of (final place / teams placed)
 *   from `GET /api/stats/competitions/:id/favourites-history`. That share is turned into race-place units by
 *   multiplying by this age group's typical race field, so both sides read on the same scale.
 *
 * The two are blended with `eventWeight = races / (races + HISTORY_K)`. With K = 4, a team with no races yet is all
 * history, after 4 races it is half and half, after 12 races it is 75% this event. A team with only one of the two
 * uses it alone; a team with neither is not ranked. Hors concours teams are left out. The figure shown is an average
 * place, not a probability: nothing here is betting odds.
 */
export const HISTORY_K = 4;

export interface FavouriteHistory { teamId: number; teamName: string; historyPlaceShare: number | null; historyEntries: number }

export interface Favourite {
  teamId: number;
  teamName: string;
  /** Blended average place in this age group's races, to one decimal place. Lower is better. */
  avgPlace: number;
  /** Races this event the figure leans on. */
  races: number;
  basis: 'blend' | 'event' | 'history';
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Reads the history answer, dropping anything malformed so a bad reply never breaks the card. */
export function parseFavouriteHistory(raw: unknown): FavouriteHistory[] {
  if (!Array.isArray(raw)) return [];
  const rows: FavouriteHistory[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (!isFiniteNumber(row.teamId) || typeof row.teamName !== 'string') continue;
    const share = isFiniteNumber(row.historyPlaceShare) && row.historyPlaceShare > 0 && row.historyPlaceShare <= 1 ? row.historyPlaceShare : null;
    rows.push({ teamId: row.teamId, teamName: row.teamName, historyPlaceShare: share, historyEntries: isFiniteNumber(row.historyEntries) ? row.historyEntries : 0 });
  }
  return rows;
}

/** The weight on this event's races: 0 with none, 0.5 after K, tending to 1. */
export const eventWeight = (races: number) => (races <= 0 ? 0 : races / (races + HISTORY_K));

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Each team's average race place so far and the typical race field, from the scored races of one age group. */
export function eventPlaces(sessions: Pick<Session, 'competitionSectionId' | 'heats'>[], sectionId: number) {
  const totals = new Map<number, { sum: number; races: number }>();
  let fieldSum = 0;
  let fieldRaces = 0;
  let widest = 0;
  for (const session of sessions) {
    if (session.competitionSectionId !== sectionId) continue;
    for (const heat of session.heats) {
      widest = Math.max(widest, heat.entries.length);
      for (const race of heat.races) {
        if (!race.isComplete) continue;
        const riding = race.results.filter((result) => !result.isSitOut);
        if (riding.length < 2) continue;
        fieldSum += riding.length;
        fieldRaces += 1;
        for (const result of riding) {
          if (result.placing == null || result.eliminated) continue;
          const known = totals.get(result.teamId) ?? { sum: 0, races: 0 };
          totals.set(result.teamId, { sum: known.sum + result.placing, races: known.races + 1 });
        }
      }
    }
  }
  const field = fieldRaces > 0 ? fieldSum / fieldRaces : widest >= 2 ? widest : null;
  return { totals, field };
}

/** The ranked favourites for an age group, best first. Teams with no race places and no history are left out. */
export function likelyWinners(
  sessions: Pick<Session, 'competitionSectionId' | 'heats'>[],
  teams: Pick<Team, 'id' | 'displayName' | 'isHorsConcours' | 'competitionSectionId'>[],
  history: FavouriteHistory[],
  sectionId: number,
): Favourite[] {
  const { totals, field } = eventPlaces(sessions, sectionId);
  const past = new Map(history.map((row) => [row.teamId, row]));
  const ranked: (Favourite & { raw: number })[] = [];
  for (const team of teams) {
    if (team.competitionSectionId !== sectionId || team.isHorsConcours) continue;
    const event = totals.get(team.id);
    const share = past.get(team.id)?.historyPlaceShare ?? null;
    const eventAvg = event && event.races > 0 ? event.sum / event.races : null;
    // Without a field size there is no way to put history on the race scale, so it is not used.
    const historyAvg = share != null && field != null ? share * field : null;
    if (eventAvg == null && historyAvg == null) continue;
    const races = event?.races ?? 0;
    const weight = eventWeight(races);
    const avg = eventAvg != null && historyAvg != null ? weight * eventAvg + (1 - weight) * historyAvg : (eventAvg ?? historyAvg)!;
    ranked.push({
      teamId: team.id,
      teamName: team.displayName,
      raw: Math.max(1, avg),
      avgPlace: round1(Math.max(1, avg)),
      races,
      basis: eventAvg != null && historyAvg != null ? 'blend' : eventAvg != null ? 'event' : 'history',
    });
  }
  return ranked
    .sort((a, b) => a.raw - b.raw || b.races - a.races || a.teamName.localeCompare(b.teamName))
    .map(({ raw: _raw, ...favourite }) => { void _raw; return favourite; });
}
