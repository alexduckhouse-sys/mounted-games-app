import { useEffect, useState } from 'react';
import { api } from '../api';
import { scorerApi } from './scorerLink';
import type { Heat } from '../types';
import { nextToSend, outcomeOfError, settle, type QueuedScore, type SendOutcome } from './scoreOutbox';

const KEY = 'mg.outbox.scores';
const CHANGED = 'mg:outbox';
/** Fired with `{ sessionId, heat }` when the server answers with a heat, so open pages can show it. */
export const HEAT_SAVED = 'mg:heat-saved';
export const IN_FLIGHT_GRACE_MS = 1500;

const failedAttemptIds = new Set<string>();
const itemKey = (item: Pick<QueuedScore, 'raceId' | 'saveId' | 'queuedAt'>) => `${item.raceId}@${item.saveId ?? item.queuedAt}`;

/** Remaining ms to suppress the offline-waiting banner while an initial online save is in flight. */
export function inFlightGraceRemainingMs(q: QueuedScore, now = Date.now()): number {
  if (!navigator.onLine || failedAttemptIds.has(itemKey(q))) return 0;
  const queuedAtMs = Date.parse(q.queuedAt);
  if (!Number.isFinite(queuedAtMs)) return 0;
  const ageMs = now - queuedAtMs;
  return ageMs >= 0 && ageMs < IN_FLIGHT_GRACE_MS ? IN_FLIGHT_GRACE_MS - ageMs : 0;
}

export function readOutbox(): QueuedScore[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed as QueuedScore[] : [];
  } catch {
    return [];
  }
}

export const OUTBOX_STORAGE_ERROR = 'These scores couldn’t be saved on this phone. Keep this page open, free some storage, then try again.';

function writeOutbox(next: QueuedScore[]): boolean {
  try {
    if (next.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(next));
  } catch { return false; }
  window.dispatchEvent(new CustomEvent(CHANGED));
  return true;
}

export function updateOutbox(change: (list: QueuedScore[]) => QueuedScore[]): boolean {
  const next = change(readOutbox()).map((q) => (q.saveId ? q : { ...q, saveId: crypto.randomUUID() }));
  if (!writeOutbox(next)) return false;
  if (nextToSend(next)) void flushOutbox();
  return true;
}

async function send(item: QueuedScore): Promise<SendOutcome> {
  try {
    // A scorer link saves through its own endpoint and token; an account uses the staff endpoint.
    const client = item.viaLink ? scorerApi : api;
    const path = item.viaLink ? `/scorer/races/${item.raceId}/results` : `/races/${item.raceId}/results`;
    const { data } = await client.post<Heat>(path,
      { places: item.places, expected: item.expected, ...(item.reason ? { reason: item.reason } : {}) }, { timeout: 15_000 });
    return { kind: 'saved', sessionId: item.sessionId, heat: data };
  } catch (err) {
    return outcomeOfError(err, item.viaLink);
  }
}

let flushing: Promise<void> | null = null;

/** Send waiting results one at a time, oldest first, until the queue is empty or the signal drops. */
export function flushOutbox(): Promise<void> {
  // Cleared in .finally(), which always runs after this assignment, even when
  // there's nothing to send and sendWaiting() finishes straight away.
  flushing ??= sendWaiting().finally(() => { flushing = null; });
  return flushing;
}

async function sendWaiting() {
  // Each save is sent at most once per flush, even if storage can't record the result.
  const sent = new Set<string>();
  for (let item = nextToSend(readOutbox()); item && navigator.onLine; item = nextToSend(readOutbox())) {
    const id = itemKey(item);
    if (sent.has(id)) return;
    sent.add(id);
    const outcome = await send(item);
    if (outcome.kind === 'saved' || outcome.kind === 'conflict') {
      failedAttemptIds.delete(id);
      window.dispatchEvent(new CustomEvent(HEAT_SAVED, { detail: { sessionId: outcome.sessionId, heat: outcome.heat } }));
    }
    if (outcome.kind === 'offline') failedAttemptIds.add(id);
    if (!writeOutbox(settle(readOutbox(), item, outcome))) return;
    if (outcome.kind === 'offline') return;
  }
}

/** Retry whenever the phone may have signal again. Call once at start-up. */
export function startOutboxSync() {
  const kick = () => { if (document.visibilityState === 'visible') void flushOutbox(); };
  window.addEventListener('online', kick);
  document.addEventListener('visibilitychange', kick);
  setInterval(kick, 20_000);
  kick();
}

/** The queued results, kept up to date across components and tabs. */
export function useScoreOutbox(): QueuedScore[] {
  const [list, setList] = useState(readOutbox);
  useEffect(() => {
    const refresh = () => setList(readOutbox());
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) refresh(); };
    window.addEventListener(CHANGED, refresh);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CHANGED, refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  return list;
}
