import type { Heat, ResultRow } from '../types';
import { effectiveStatus, statusLetter } from '../lib/resultStatus.ts';
import { ordinal } from '../lib/toplist.ts';

/**
 * Race results saved on a scorer's phone, sent in order whenever there's
 * signal. Each save carries the results the scorer saw, so the server can
 * refuse it if another phone scored the race differently in the meantime.
 */
export interface Placing {
  teamId: number;
  place: number;
  eliminated: boolean;
  /** Manual points override (supports .5 increments for dead heats and judge overrides). */
  points?: number;
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
  const key = (places: Placing[]) => places.map((p) => {
    const pts = typeof p.points === 'number' && Number.isFinite(p.points) ? `/${p.points}` : '';
    return `${p.teamId}:${p.eliminated ? statusLetter(true, p.status) : p.place}${pts}`;
  }).sort().join(',');
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

export interface OutboxBackupPayload {
  version: 1;
  competitionId: number;
  exportedAt: string;
  scores: QueuedScore[];
}

/** Serialises unsynced scores for a competition into a portable JSON backup string. */
export function serializeOutboxBackup(
  list: QueuedScore[],
  competitionId: number,
  exportedAt = new Date().toISOString(),
): string {
  const scores = list.filter((q) => q.competitionId === competitionId);
  const payload: OutboxBackupPayload = { version: 1, competitionId, exportedAt, scores };
  return JSON.stringify(payload);
}

function isValidPlacing(value: unknown): value is Placing {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.teamId === 'number' && Number.isFinite(p.teamId) &&
    typeof p.place === 'number' && Number.isFinite(p.place) &&
    typeof p.eliminated === 'boolean'
  );
}

/** Parses and validates an exported outbox backup JSON string, resetting imported items to 'waiting'. */
export function parseOutboxBackup(
  raw: string,
  fallbackCompetitionId?: number,
  viaLinkOverride?: boolean,
): QueuedScore[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const topCompId = parsed && typeof parsed === 'object' && typeof (parsed as { competitionId?: unknown }).competitionId === 'number'
    ? (parsed as { competitionId: number }).competitionId
    : undefined;
  const items = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { scores?: unknown }).scores))
      ? (parsed as { scores: unknown[] }).scores
      : null;
  if (!items || items.length === 0) return null;

  const out: QueuedScore[] = [];
  for (const entry of items) {
    if (!entry || typeof entry !== 'object') return null;
    const item = entry as Record<string, unknown>;
    if (
      typeof item.raceId !== 'number' || !Number.isFinite(item.raceId) || item.raceId <= 0 ||
      typeof item.sessionId !== 'number' || !Number.isFinite(item.sessionId) || item.sessionId <= 0 ||
      typeof item.label !== 'string' || !item.label.trim() ||
      !Array.isArray(item.places) || item.places.length === 0 || !item.places.every(isValidPlacing)
    ) {
      return null;
    }
    const expected = Array.isArray(item.expected) && item.expected.every(isValidPlacing) ? item.expected : [];
    const teamNames: Record<number, string> = {};
    if (item.teamNames && typeof item.teamNames === 'object') {
      for (const [k, v] of Object.entries(item.teamNames as Record<string, unknown>)) {
        const id = Number(k);
        if (Number.isFinite(id) && typeof v === 'string') teamNames[id] = v;
      }
    }
    const compId = typeof item.competitionId === 'number' && Number.isFinite(item.competitionId) && item.competitionId > 0
      ? item.competitionId
      : (topCompId ?? fallbackCompetitionId ?? 0);
    if (!compId || compId <= 0) return null;
    if (fallbackCompetitionId !== undefined && compId !== fallbackCompetitionId) return null;
    const viaLink = viaLinkOverride !== undefined ? viaLinkOverride : item.viaLink === true;
    out.push({
      ...(typeof item.saveId === 'string' && item.saveId ? { saveId: item.saveId } : {}),
      raceId: item.raceId,
      competitionId: compId,
      sessionId: item.sessionId,
      label: item.label.trim(),
      places: item.places,
      expected,
      teamNames,
      queuedAt: typeof item.queuedAt === 'string' && item.queuedAt ? item.queuedAt : new Date().toISOString(),
      ...(typeof item.reason === 'string' && item.reason.trim() ? { reason: item.reason.trim() } : {}),
      ...(viaLink ? { viaLink: true } : {}),
      state: 'waiting',
    });
  }
  return out;
}

/** Merges imported backup scores into the current outbox, replacing older entries for the same race while preserving newer local saves. */
export function mergeOutboxBackup(existing: QueuedScore[], imported: QueuedScore[]): QueuedScore[] {
  return imported.reduce((acc, item) => {
    const current = acc.find((q) => q.raceId === item.raceId);
    if (current) {
      const currentMs = Date.parse(current.queuedAt);
      const importedMs = Date.parse(item.queuedAt);
      if (Number.isFinite(currentMs) && Number.isFinite(importedMs) && currentMs > importedMs) {
        return acc;
      }
    }
    return enqueue(acc, item);
  }, existing);
}
