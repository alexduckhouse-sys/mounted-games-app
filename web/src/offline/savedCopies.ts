import { activeLocale, tr } from '../i18n/translate';
import { isLiteModeActive } from '../lite/liteMode';

/**
 * The last copy of each public page's data, kept in localStorage so a page opens straight away from what this
 * phone last saw, then refreshes from the server. Only public data goes here (see cachePolicy.ts); cookies
 * would cap each copy at about 4 KB and send it with every request, so they are not used.
 */
const PREFIX = 'mg.saved.v1.';
const INDEX_KEY = `${PREFIX}index`;
/** Enough for a weekend's competitions and their age groups without filling the storage quota. */
const MAX_COPIES = 24;

export interface SavedCopy<T> {
  savedAt: string;
  data: T;
}

function readIndex(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : [];
  } catch {
    return [];
  }
}

function writeIndex(keys: string[]) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(keys));
}

/** Account-only payment details must never survive in a shared public copy. */
function publicCopyData<T>(key: string, data: T): T {
  if (!/^competition\.\d+$/.test(key) || data == null || typeof data !== 'object' || !('paymentDestination' in data)) return data;
  const copy = { ...data } as Record<string, unknown>;
  delete copy.paymentDestination;
  return copy as T;
}

export function readSavedCopy<T>(key: string): SavedCopy<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedCopy<T>>;
    if (typeof parsed.savedAt !== 'string' || Number.isNaN(Date.parse(parsed.savedAt)) || parsed.data == null) return null;
    const data = publicCopyData(key, parsed.data);
    if (data !== parsed.data) {
      parsed.data = data;
      // Rewrite old copies too, so signing out cannot expose a previous account's details.
      localStorage.setItem(PREFIX + key, JSON.stringify(parsed));
    }
    return parsed as SavedCopy<T>;
  } catch {
    return null;
  }
}

/** Saves `data` as the newest copy for `key`, dropping the least recently saved copies to make room. */
export function writeSavedCopy<T>(key: string, data: T, savedAt = new Date()): void {
  let value: string;
  try {
    value = JSON.stringify({ savedAt: savedAt.toISOString(), data: publicCopyData(key, data) } satisfies SavedCopy<T>);
  } catch {
    return;
  }
  const keys = [...readIndex().filter((k) => k !== key), key];
  const evict = () => {
    const oldest = keys.shift();
    if (oldest) localStorage.removeItem(PREFIX + oldest);
  };
  try {
    while (keys.length > MAX_COPIES) evict();
    // A full quota drops the oldest copies one at a time until this one fits (or nothing else is left).
    for (;;) {
      try {
        localStorage.setItem(PREFIX + key, value);
        break;
      } catch {
        if (keys.length <= 1) {
          localStorage.removeItem(PREFIX + key);
          keys.length = 0;
          break;
        }
        evict();
      }
    }
    writeIndex(keys);
  } catch {
    /* storage blocked (private mode) — the page still works, it just won't open offline */
  }
}

export const savedCopyKeys = {
  competition: (id: number) => `competition.${id}`,
  standings: (competitionId: number, sectionId: number) => `standings.${competitionId}.${sectionId}`,
  picker: (past: boolean) => `picker.${past ? 'past' : 'upcoming'}`,
};

/**
 * How old a saved copy must be before the page says so. A copy that is only a little old is not worth a notice:
 * a normal load, a quick refresh or a short wobble in the signal should show nothing at all.
 */
export const SAVED_COPY_NOTICE_AFTER_MS = 30 * 60_000;
/** Competition pages and scoring during an event change every few minutes, so a copy goes stale sooner. */
export const LIVE_SAVED_COPY_NOTICE_AFTER_MS = 10 * 60_000;
/** Freshness window (2 minutes) in Lite Mode where a recently saved copy avoids redundant background fetches. */
export const LITE_FRESH_COPY_WINDOW_MS = 2 * 60_000;

type SavedAtLike = Date | string | number | null | undefined;

function savedAtMs(savedAt: SavedAtLike): number | null {
  if (savedAt == null || savedAt === '') return null;
  const ms = savedAt instanceof Date ? savedAt.getTime() : typeof savedAt === 'number' ? savedAt : Date.parse(savedAt);
  return Number.isNaN(ms) ? null : ms;
}

/** True when Lite Mode is on and the saved copy was written within `windowMs` of `now`. */
export function isFreshSavedCopy(
  savedAt: SavedAtLike,
  lite = isLiteModeActive(),
  now: Date = new Date(),
  windowMs = LITE_FRESH_COPY_WINDOW_MS,
): boolean {
  if (!lite) return false;
  const ms = savedAtMs(savedAt);
  if (ms == null) return false;
  const age = now.getTime() - ms;
  return age >= 0 && age <= windowMs;
}

/** True when a dated copy is older than `thresholdMs`. An undated copy is never "noticeably old" on its own. */
export function isNoticeablyOld(savedAt: SavedAtLike, now: Date = new Date(), thresholdMs = SAVED_COPY_NOTICE_AFTER_MS): boolean {
  const ms = savedAtMs(savedAt);
  return ms != null && now.getTime() - ms > thresholdMs;
}

/**
 * Whether to tell the person they are looking at an old copy. Only when no fresh copy has arrived
 * (`refreshFailed`) and the copy on screen is older than the threshold; an undated copy counts as old
 * only because the refresh failed.
 */
export function shouldNoticeSavedCopy(savedAt: SavedAtLike, refreshFailed: boolean, now: Date = new Date(), thresholdMs = SAVED_COPY_NOTICE_AFTER_MS): boolean {
  if (!refreshFailed) return false;
  return savedAtMs(savedAt) == null ? true : isNoticeablyOld(savedAt, now, thresholdMs);
}

/** "Last updated 14:05" for today, "Last updated 12 Oct, 14:05" for an earlier day, "Last updated earlier" when undated. */
export function lastUpdatedText(savedAt: SavedAtLike, now: Date = new Date()): string {
  const ms = savedAtMs(savedAt);
  if (ms == null) return tr('shell.saved.earlier');
  const at = new Date(ms);
  const locale = activeLocale();
  const time = at.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (at.toDateString() === now.toDateString()) return tr('shell.saved.today', { time });
  return tr('shell.saved.day', { date: at.toLocaleDateString(locale, { day: 'numeric', month: 'short' }), time });
}

/** When the response is the service worker's fallback copy, the time it was saved; otherwise null. */
export function serviceWorkerSavedAt(headers: Record<string, unknown>): Date | null | 'unknown' {
  if (headers['x-mg-saved-copy'] !== '1') return null;
  const at = Date.parse(String(headers['x-mg-saved-at'] ?? ''));
  return Number.isNaN(at) ? 'unknown' : new Date(at);
}
