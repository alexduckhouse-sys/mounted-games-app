import { useEffect, useState } from 'react';
import { api } from '../api';
import { scorerApi } from './scorerLink';
import type { Heat } from '../types';
import {
  mergeOutboxBackup,
  nextToSend,
  outcomeOfError,
  parseOutboxBackup,
  serializeOutboxBackup,
  settle,
  type QueuedScore,
  type SendOutcome,
} from './scoreOutbox';

const KEY = 'mg.outbox.scores';
const CHANGED = 'mg:outbox';
/** Fired with `{ sessionId, heat }` when the server answers with a heat, so open pages can show it. */
export const HEAT_SAVED = 'mg:heat-saved';
/** Fired with `{ competitionId, label }` each time a flush gets a waiting save accepted by the server. */
export const SCORE_SENT = 'mg:score-sent';
export const IN_FLIGHT_GRACE_MS = 1500;

/** Saves whose POST has been started and not yet answered. */
const inFlightIds = new Set<string>();
/** True while this save is being sent, so it may already be committing on the server. */
export function isSaveInFlight(q: Pick<QueuedScore, 'raceId' | 'saveId' | 'queuedAt'>): boolean {
  return inFlightIds.has(`${q.raceId}@${q.saveId ?? q.queuedAt}`);
}

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
    inFlightIds.add(id);
    let outcome: SendOutcome;
    try { outcome = await send(item); } finally { inFlightIds.delete(id); }
    if (outcome.kind === 'saved') {
      window.dispatchEvent(new CustomEvent(SCORE_SENT, { detail: { competitionId: item.competitionId, label: item.label } }));
    }
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
    const onStorage = (e: StorageEvent) => { if (e.key === KEY || e.key === null) refresh(); };
    window.addEventListener(CHANGED, refresh);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CHANGED, refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  return list;
}

// Unused in web UI yet — reserved for iOS / upcoming offline outbox backup UI wiring
/** Serialise a competition's queued offline scores into a shareable JSON backup string. */
export function exportCompetitionOutbox(competitionId: number, now?: string): string {
  return serializeOutboxBackup(readOutbox(), competitionId, now);
}

export const OUTBOX_IMPORT_ERROR = 'That backup could not be read. Check that the whole backup was copied.';

/** Validate and merge a JSON backup of offline scores into the active outbox, flushing immediately if online. */
export function importCompetitionOutbox(
  raw: string,
  options?: { fallbackCompetitionId?: number; viaLink?: boolean },
): { ok: true; count: number } | { ok: false; error: string } {
  const viaLinkOverride =
    options?.viaLink !== undefined
      ? options.viaLink
      : (() => {
          try {
            return Boolean(localStorage.getItem('mg.scorer.token')?.trim());
          } catch {
            return false;
          }
        })();
  const parsed = parseOutboxBackup(raw, options?.fallbackCompetitionId, viaLinkOverride);
  if (!parsed) return { ok: false, error: OUTBOX_IMPORT_ERROR };
  if (!updateOutbox((current) => mergeOutboxBackup(current, parsed))) {
    return { ok: false, error: OUTBOX_STORAGE_ERROR };
  }
  return { ok: true, count: parsed.length };
}

/** Share a competition's offline outbox backup via the native share sheet, or copy it to the clipboard. */
export async function shareOrCopyOutboxBackup(
  competitionId: number,
  competitionName?: string,
): Promise<'shared' | 'copied' | 'unavailable'> {
  const json = exportCompetitionOutbox(competitionId);
  const title = competitionName ? `${competitionName} — offline score backup` : 'Offline score backup';
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text: json });
      return 'shared';
    } catch {
      // Fall back to clipboard if the share sheet was dismissed or unsupported for text.
    }
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(json);
      return 'copied';
    } catch {
      return 'unavailable';
    }
  }
  return 'unavailable';
}
