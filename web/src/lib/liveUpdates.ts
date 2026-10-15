import type { CompetitionDetail, Heat } from '../types';

/**
 * `resultsUpdated` carries either a whole heat (results saved, duration
 * changed) or a race clock change (`raceId` plus `started` or `finished`).
 */
export type ResultsUpdate =
  | { sessionId: number; heat: Heat }
  | { sessionId: number; raceId: number; started?: string | null; finished?: string | null };

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
