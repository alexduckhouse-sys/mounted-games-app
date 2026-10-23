import type { Heat, ResultRow } from '../types';
import { effectiveStatus, statusLetter } from '../lib/resultStatus.ts';

/**
 * Race results saved on a scorer's phone, sent in order whenever there's
 * signal. Each save carries the results the scorer saw, so the server can
 * refuse it if another phone scored the race differently in the meantime.
 */
export interface Placing {
  teamId: number;
  place: number;
  eliminated: boolean;
  /** Why the team did not finish: 1 E, 2 DNS, 3 DNF, 4 R. Left out means eliminated. */
  status?: number;
  /** A private note for staff. Left out keeps the saved note. */
  refereeNote?: string;
}

export interface QueuedScore {
  /** Unique per save, including two edits made within the same millisecond. */
  saveId?: string;
  raceId: number;
  competitionId: number;
  sessionId: number;
  /** e.g. "Heat 2 · Barrel Race", for the outbox panel. */
  label: string;
  places: Placing[];
  expected: Placing[];
  teamNames: Record<number, string>;
  queuedAt: string;
  reason?: string;
  /** Sent with a scorer link's token instead of a signed-in account. */
  viaLink?: boolean;
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
  return results.map((r) => ({
    teamId: r.teamId, place: r.placing ?? 0, eliminated: r.eliminated,
    ...(r.eliminated ? { status: effectiveStatus(true, r.status) } : {}),
  }));
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
  const same = (q: QueuedScore) => q.raceId === sent.raceId &&
    (sent.saveId ? q.saveId === sent.saveId : q.queuedAt === sent.queuedAt);
  if (!list.some(same)) {
    // A scorer corrected their own queued save while it was being sent. Once
    // that save lands, the correction must compare against it, not its old base.
    if (outcome.kind !== 'saved') return list;
    const accepted = outcome.heat.races.find((r) => r.id === sent.raceId);
    if (!accepted) return list;
    return list.map((q) => q.raceId === sent.raceId && q.state === 'waiting' && samePlacings(q.expected, sent.expected)
      ? { ...q, expected: placingsOf(accepted.results) } : q);
  }
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

function samePlacings(a: Placing[], b: Placing[]): boolean {
  const key = (places: Placing[]) => places.map((p) => `${p.teamId}:${p.eliminated ? statusLetter(true, p.status) : p.place}`).sort().join(',');
  return key(a) === key(b);
}

/** Send mine anyway: it now replaces the results the other device saved. */
export function overrule(list: QueuedScore[], raceId: number, reason?: string): QueuedScore[] {
  return list.map((q) => q.raceId === raceId && q.state === 'conflict'
    ? { ...q, state: 'waiting', expected: q.theirs ?? [], theirs: undefined, ...(reason === undefined ? {} : { reason }) }
    : q);
}

export function retry(list: QueuedScore[], raceId: number, reason?: string): QueuedScore[] {
  return list.map((q) => q.raceId === raceId && q.state === 'failed' ? { ...q, state: 'waiting', error: undefined, ...(reason === undefined ? {} : { reason }) } : q);
}

export function discard(list: QueuedScore[], raceId: number): QueuedScore[] {
  return list.filter((q) => q.raceId !== raceId);
}

/** Turn a request error into what the outbox should do next. */
export function outcomeOfError(err: unknown, viaLink = false): SendOutcome {
  const e = err as { isAxiosError?: boolean; response?: { status: number; data?: { sessionId?: number; heat?: Heat; message?: string } } } | null;
  const res = e?.response;
  // No answer, or the server is waking up / overloaded: keep it and try later.
  if (!res || res.status >= 500 || res.status === 408 || res.status === 429) return { kind: 'offline' };
  if (res.status === 409 && res.data?.heat && res.data.sessionId != null) {
    return { kind: 'conflict', sessionId: res.data.sessionId, heat: res.data.heat };
  }
  if (viaLink) {
    if (res.status === 401) return { kind: 'failed', message: 'This phone has lost its scorer link. Open the link the organiser sent you again.' };
    if (res.status === 410) return { kind: 'failed', message: 'This scorer link has expired or been withdrawn. Ask the organiser for a new one.' };
    if (res.status === 404) return { kind: 'failed', message: 'This race isn’t in your arena, or the link is no longer valid.' };
    if (res.status === 403) return { kind: 'failed', message: 'This scorer link can’t save scores.' };
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
    .map((p) => p.eliminated ? `${name(p.teamId)} ${statusLetter(true, p.status) === 'E' ? 'out' : statusLetter(true, p.status)}` : `${ordinal(p.place)} ${name(p.teamId)}`)
    .join(' · ');
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}
