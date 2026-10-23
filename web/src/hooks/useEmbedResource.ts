import { useCallback, useEffect, useRef, useState } from 'react';
import { EMBED_REQUEST_HEADER } from '../offline/cachePolicy';

const BASE = import.meta.env.VITE_API_BASE ?? '/api';
const TIMEOUT_MS = 15_000;

export class EmbedFetchError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Request failed with ${status}`);
    this.status = status;
  }
}

/**
 * One public GET for the embedded widget. It deliberately avoids the app's own API client: no sign-in
 * token, no cookies, and a header that tells the service worker to keep its caches out of it.
 */
export async function fetchEmbedJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const forward = () => controller.abort();
  signal?.addEventListener('abort', forward);
  try {
    const response = await fetch(`${BASE}${path}`, {
      signal: controller.signal,
      credentials: 'omit',
      headers: { Accept: 'application/json', [EMBED_REQUEST_HEADER]: '1' },
    });
    if (!response.ok) throw new EmbedFetchError(response.status);
    // An API build that doesn't know a route answers with the app's HTML page; that is never data.
    if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('json')) throw new EmbedFetchError(404);
    return await response.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forward);
  }
}

export type EmbedError = 'notfound' | 'failed';

export interface EmbedResource<T> {
  data: T | null;
  error: EmbedError | null;
  /** When `data` last came from the server. */
  updatedAt: Date | null;
  /** Checks that failed in a row since the last success. */
  failures: number;
  reload: () => void;
}

interface State<T> { path: string | null; data: T | null; error: EmbedError | null; updatedAt: Date | null; failures: number }

const jitter = (ms: number) => Math.round(ms * (0.9 + Math.random() * 0.2));

/**
 * Loads a public resource and keeps it fresh by polling. `intervalMs` says how long to wait after each
 * answer. Polling pauses while the frame is hidden or the device is offline and picks up again straight
 * away when it can; the browser sends If-None-Match, so an unchanged answer is a cheap 304.
 */
export function useEmbedResource<T>(
  path: string | null,
  isValid: (value: unknown) => value is T,
  intervalMs: (data: T | null, failures: number) => number,
): EmbedResource<T> {
  const [state, setState] = useState<State<T>>({ path: null, data: null, error: null, updatedAt: null, failures: 0 });
  const [attempt, setAttempt] = useState(0);
  const interval = useRef(intervalMs);
  const valid = useRef(isValid);
  useEffect(() => { interval.current = intervalMs; valid.current = isValid; });

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    let waiting = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let data: T | null = null;
    let failures = 0;

    async function run() {
      timer = undefined;
      if (cancelled) return;
      if (document.visibilityState === 'hidden' || navigator.onLine === false) { waiting = true; return; }
      waiting = false;
      controller = new AbortController();
      try {
        const value = await fetchEmbedJson(path as string, controller.signal);
        if (cancelled) return;
        if (!valid.current(value)) throw new EmbedFetchError(502);
        data = value;
        failures = 0;
        setState({ path, data, error: null, updatedAt: new Date(), failures });
      } catch (reason) {
        if (cancelled) return;
        failures += 1;
        const error: EmbedError = reason instanceof EmbedFetchError && reason.status === 404 ? 'notfound' : 'failed';
        setState((previous) => ({ path, data: previous.path === path ? previous.data : null, error, updatedAt: previous.path === path ? previous.updatedAt : null, failures }));
      }
      timer = setTimeout(run, jitter(interval.current(data, failures)));
    }

    function resume() {
      if (waiting && document.visibilityState === 'visible' && navigator.onLine !== false) void run();
    }

    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    void run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
    };
  }, [path, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const current = state.path === path ? state : null;
  return { data: current?.data ?? null, error: current?.error ?? null, updatedAt: current?.updatedAt ?? null, failures: current?.failures ?? 0, reload };
}
