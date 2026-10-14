export const WEATHER_REFRESH_MS = 30 * 60_000;

/** Shares in-flight requests and limits repeated forecast downloads. */
export function createRequestCache(now: () => number = Date.now) {
  const entries = new Map<string, { expires: number; promise: Promise<unknown> }>();
  return function request<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const existing = entries.get(key);
    if (existing && existing.expires > now()) return existing.promise as Promise<T>;
    const entry = { expires: now() + WEATHER_REFRESH_MS, promise: Promise.resolve().then(fetcher) };
    entries.delete(key);
    entries.set(key, entry);
    if (entries.size > 128) entries.delete(entries.keys().next().value!);
    // Briefly reuse failures too, so a failing forecast service isn't hammered.
    void entry.promise.catch(() => { entry.expires = now() + 60_000; });
    return entry.promise;
  };
}

export function forecastHour(value: string | Date): string {
  const date = new Date(value);
  date.setUTCMinutes(0, 0, 0);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}
