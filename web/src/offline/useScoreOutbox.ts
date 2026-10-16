import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Heat } from '../types';
import { nextToSend, outcomeOfError, settle, type QueuedScore, type SendOutcome } from './scoreOutbox';

const KEY = 'mg.outbox.scores';
const CHANGED = 'mg:outbox';
/** Fired with `{ sessionId, heat }` when the server answers with a heat, so open pages can show it. */
export const HEAT_SAVED = 'mg:heat-saved';

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
  const next = change(readOutbox());
  if (!writeOutbox(next)) return false;
  if (nextToSend(next)) void flushOutbox();
  return true;
}

async function send(item: QueuedScore): Promise<SendOutcome> {
  try {
    const { data } = await api.post<Heat>(`/races/${item.raceId}/results`,
      { places: item.places, expected: item.expected, ...(item.reason ? { reason: item.reason } : {}) }, { timeout: 15_000 });
    return { kind: 'saved', sessionId: item.sessionId, heat: data };
  } catch (err) {
    return outcomeOfError(err);
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
    const id = `${item.raceId}@${item.saveId ?? item.queuedAt}`;
    if (sent.has(id)) return;
    sent.add(id);
    const outcome = await send(item);
    if (outcome.kind === 'saved' || outcome.kind === 'conflict') {
      window.dispatchEvent(new CustomEvent(HEAT_SAVED, { detail: { sessionId: outcome.sessionId, heat: outcome.heat } }));
    }
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
