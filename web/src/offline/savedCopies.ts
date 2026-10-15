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

export function readSavedCopy<T>(key: string): SavedCopy<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedCopy<T>>;
    if (typeof parsed.savedAt !== 'string' || Number.isNaN(Date.parse(parsed.savedAt)) || parsed.data == null) return null;
    return parsed as SavedCopy<T>;
  } catch {
    return null;
  }
}

/** Saves `data` as the newest copy for `key`, dropping the least recently saved copies to make room. */
export function writeSavedCopy<T>(key: string, data: T, savedAt = new Date()): void {
  let value: string;
  try {
    value = JSON.stringify({ savedAt: savedAt.toISOString(), data } satisfies SavedCopy<T>);
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

/** When the response is the service worker's fallback copy, the time it was saved; otherwise null. */
export function serviceWorkerSavedAt(headers: Record<string, unknown>): Date | null | 'unknown' {
  if (headers['x-mg-saved-copy'] !== '1') return null;
  const at = Date.parse(String(headers['x-mg-saved-at'] ?? ''));
  return Number.isNaN(at) ? 'unknown' : new Date(at);
}
