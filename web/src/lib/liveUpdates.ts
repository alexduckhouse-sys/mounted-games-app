import type { CompetitionDetail, Heat } from '../types';

/**
 * `resultsUpdated` carries either a whole heat (results saved, duration
 * changed), a race clock change, a team change, or a tack-check standings invalidation.
 */
export type ResultsUpdate =
  | { sessionId: number; heat: Heat }
  | { sessionId: number; raceId: number; started?: string | null; finished?: string | null }
  | { teamId: number; refereeCard?: 'yellow' | 'red' | null }
  | { teamId: number; isHorsConcours: boolean }
  | { sectionId: number; teamId: number | null; tackCheck: true };

export function replaceHeat(competition: CompetitionDetail, sessionId: number, heat: Heat): CompetitionDetail {
  return {
    ...competition,
    sessions: competition.sessions.map((s) => s.id !== sessionId ? s : {
      ...s,
      heats: s.heats.map((h) => (h.id === heat.id ? heat : h)),
    }),
  };
}

export function applyResultsUpdate(competition: CompetitionDetail, update: ResultsUpdate): CompetitionDetail {
  if ('heat' in update) return update.heat ? replaceHeat(competition, update.sessionId, update.heat) : competition;
  if ('teamId' in update && !('sessionId' in update)) {
    if ('isHorsConcours' in update && typeof update.isHorsConcours === 'boolean') {
      return {
        ...competition,
        teams: competition.teams.map((t) => t.id === update.teamId ? { ...t, isHorsConcours: update.isHorsConcours } : t),
      };
    }
    // Tack-check events only invalidate the standings; an omitted card never means clear it.
    if (!('refereeCard' in update) || typeof update.teamId !== 'number') return competition;
    const card = update.refereeCard ?? null;
    return {
      ...competition,
      teams: competition.teams.map((t) => (t.id === update.teamId ? { ...t, refereeCard: card } : t)),
      sessions: competition.sessions.map((s) => ({
        ...s,
        heats: s.heats.map((h) => ({
          ...h,
          entries: h.entries.map((e) => (e.teamId === update.teamId ? { ...e, refereeCard: card } : e)),
        })),
      })),
    };
  }
  if (!('raceId' in update) || typeof update.raceId !== 'number') return competition;
  const { raceId } = update;
  return {
    ...competition,
    sessions: competition.sessions.map((s) => s.id !== update.sessionId ? s : {
      ...s,
      heats: s.heats.map((h) => !h.races.some((r) => r.id === raceId) ? h : {
        ...h,
        races: h.races.map((r) => r.id !== raceId ? r : 'started' in update
          // Starting (or restarting) clears the finish, matching the API.
          ? { ...r, startedAt: update.started ?? null, finishedAt: null }
          : { ...r, finishedAt: update.finished ?? null }),
      }),
    }),
  };
}

/** True when the request never got an answer (no signal, timeout), not when the server refused it. */
export function isNetworkError(err: unknown): boolean {
  const e = err as { isAxiosError?: boolean; response?: unknown; code?: string } | null;
  return !!e?.isAxiosError && !e.response && e.code !== 'ERR_CANCELED';
}

/**
 * Retry a request that is safe to repeat (the server replaces rather than
 * appends) while the failure is a lost connection. Server errors fail fast.
 */
export async function retryOnNetworkError<T>(
  send: () => Promise<T>,
  { delays = [2_000, 5_000], wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) }: {
    delays?: number[];
    wait?: (ms: number) => Promise<void>;
  } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await send();
    } catch (err) {
      if (attempt >= delays.length || !isNetworkError(err)) throw err;
      await wait(delays[attempt]);
    }
  }
}
