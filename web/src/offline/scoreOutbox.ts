import type { Heat, ResultRow } from '../types';

/**
 * Race results saved on a scorer's phone, sent in order whenever there's
 * signal. Each save carries the results the scorer saw, so the server can
 * refuse it if another phone scored the race differently in the meantime.
 */
export interface Placing {
  teamId: number;
  place: number;
  eliminated: boolean;
}

export interface QueuedScore {
  raceId: number;
  competitionId: number;
  sessionId: number;
  /** e.g. "Heat 2 · Barrel Race", for the outbox panel. */
  label: string;
  places: Placing[];
  expected: Placing[];
  teamNames: Record<number, string>;
  queuedAt: string;
  state: 'waiting' | 'conflict' | 'failed';
  /** What the server holds, when it refused the save as a conflict. */
  theirs?: Placing[];
  error?: string;
}

export type SendOutcome =
  | { kind: 'saved'; sessionId: number; heat: Heat }
  | { kind: 'conflict'; sessionId: number; heat: Heat }
  | { kind: 'offline' }
  | { kind: 'failed'; message: string };

export function placingsOf(results: ResultRow[]): Placing[] {
  return results.map((r) => ({ teamId: r.teamId, place: r.placing ?? 0, eliminated: r.eliminated }));
}

/** A newer save for the same race replaces the one still waiting. */
export function enqueue(list: QueuedScore[], item: QueuedScore): QueuedScore[] {
  return [...list.filter((q) => q.raceId !== item.raceId), item];
}

export function nextToSend(list: QueuedScore[]): QueuedScore | undefined {
  return list.find((q) => q.state === 'waiting');
}

/** Record what happened to `sent`. A save re-queued while it was in flight is left alone. */
export function settle(list: QueuedScore[], sent: QueuedScore, outcome: SendOutcome): QueuedScore[] {
  const same = (q: QueuedScore) => q.raceId === sent.raceId && q.queuedAt === sent.queuedAt;
  if (!list.some(same)) return list;
  switch (outcome.kind) {
    case 'saved':
      return list.filter((q) => !same(q));
    case 'offline':
      return list;
    case 'conflict': {
      const race = outcome.heat.races.find((r) => r.id === sent.raceId);
      return list.map((q) => same(q) ? { ...q, state: 'conflict', theirs: placingsOf(race?.results ?? []) } : q);
    }
    case 'failed':
      return list.map((q) => same(q) ? { ...q, state: 'failed', error: outcome.message } : q);
  }
}

/** Send mine anyway: it now replaces the results the other device saved. */
export function overrule(list: QueuedScore[], raceId: number): QueuedScore[] {
  return list.map((q) => q.raceId === raceId && q.state === 'conflict'
    ? { ...q, state: 'waiting', expected: q.theirs ?? [], theirs: undefined }
    : q);
}

export function retry(list: QueuedScore[], raceId: number): QueuedScore[] {
  return list.map((q) => q.raceId === raceId && q.state === 'failed' ? { ...q, state: 'waiting', error: undefined } : q);
}

export function discard(list: QueuedScore[], raceId: number): QueuedScore[] {
  return list.filter((q) => q.raceId !== raceId);
}

/** Turn a request error into what the outbox should do next. */
export function outcomeOfError(err: unknown): SendOutcome {
  const e = err as { isAxiosError?: boolean; response?: { status: number; data?: { sessionId?: number; heat?: Heat; message?: string } } } | null;
  const res = e?.response;
  // No answer, or the server is waking up / overloaded: keep it and try later.
  if (!res || res.status >= 500 || res.status === 408 || res.status === 429) return { kind: 'offline' };
  if (res.status === 409 && res.data?.heat && res.data.sessionId != null) {
    return { kind: 'conflict', sessionId: res.data.sessionId, heat: res.data.heat };
  }
  if (res.status === 401) return { kind: 'failed', message: 'You’ve been signed out. Sign in again, then tap Try again.' };
  if (res.status === 403) return { kind: 'failed', message: 'Only admins can save scores. Sign in with an admin account, then tap Try again.' };
  if (res.status === 404) return { kind: 'failed', message: 'This race no longer exists.' };
  return { kind: 'failed', message: res.data?.message ?? 'These results were rejected. Check them and score the race again.' };
}

/** "1st Red Rum · 2nd Shergar · Arkle out" */
export function describePlacings(places: Placing[], names: Record<number, string>): string {
  if (places.length === 0) return 'No results';
  const name = (id: number) => names[id] ?? `Team ${id}`;
  return [...places]
    .sort((a, b) => Number(a.eliminated) - Number(b.eliminated) || a.place - b.place)
    .map((p) => p.eliminated ? `${name(p.teamId)} out` : `${ordinal(p.place)} ${name(p.teamId)}`)
    .join(' · ');
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}
