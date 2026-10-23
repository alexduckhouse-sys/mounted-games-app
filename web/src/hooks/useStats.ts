import { useEffect, useState } from 'react';
import { api } from '../api';
import { apiErrorStatus } from '../lib/apiError';
import { isSearchableQuery, isStatsProfile, isStatsSearch, tidyStatsQuery } from '../lib/stats';
import type { StatsProfile, StatsSearch } from '../types';

export type StatsLoad<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'missing' }
  | { status: 'error'; message: string };

const BUSY = 'Too many searches in a minute. Wait a moment and try again.';

function failure(error: unknown, fallback: string): StatsLoad<never> {
  const status = apiErrorStatus(error);
  if (status === 404) return { status: 'missing' };
  return { status: 'error', message: status === 429 ? BUSY : fallback };
}

/**
 * Searches the statistics hub once typing pauses (`delayMs`), so each word typed doesn't cost a request
 * against the rate limit. An older reply never replaces a newer one: each query aborts the last.
 */
export function useStatsSearch(query: string, delayMs = 350): StatsLoad<StatsSearch> {
  const q = tidyStatsQuery(query);
  const searchable = isSearchableQuery(q);
  const [state, setState] = useState<{ q: string; load: StatsLoad<StatsSearch> }>({ q: '', load: { status: 'idle' } });

  useEffect(() => {
    if (!searchable) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState({ q, load: { status: 'loading' } });
      api.get<unknown>('/stats/search', { params: { q }, signal: controller.signal })
        .then(({ data }) => {
          if (controller.signal.aborted) return;
          setState({ q, load: isStatsSearch(data) ? { status: 'ready', data } : { status: 'error', message: 'Search isn’t available right now.' } });
        })
        .catch((error) => { if (!controller.signal.aborted) setState({ q, load: failure(error, 'Couldn’t search. Check your connection and try again.') }); });
    }, delayMs);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [q, searchable, delayMs]);

  if (!searchable) return { status: 'idle' };
  // Until the pause is over, the last answer would be for different words: show that a search is coming.
  return state.q === q ? state.load : { status: 'loading' };
}

/** Loads a profile from `/api` + `url` (null loads nothing). `reloadKey` refetches, e.g. after signing in. */
export function useStatsProfile(url: string | null, reloadKey = ''): StatsLoad<StatsProfile> {
  const [state, setState] = useState<{ key: string; load: StatsLoad<StatsProfile> } | null>(null);
  const key = `${url}|${reloadKey}`;

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    api.get<unknown>(url, { signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        setState({ key, load: isStatsProfile(data) ? { status: 'ready', data } : { status: 'error', message: 'Statistics aren’t available right now.' } });
      })
      .catch((error) => { if (!controller.signal.aborted) setState({ key, load: failure(error, 'Couldn’t load these statistics. Check your connection and try again.') }); });
    return () => controller.abort();
  }, [url, key]);

  if (!url) return { status: 'idle' };
  return state?.key === key ? state.load : { status: 'loading' };
}
