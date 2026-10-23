import { useEffect, useState } from 'react';
import { api } from '../api';
import { apiErrorStatus } from '../lib/apiError';
import { isSearchableQuery, isStatsBrowse, isStatsProfile, tidyStatsQuery } from '../lib/stats';
import type { StatsHit, StatsProfile, StatsSubjectKind } from '../types';

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

export type StatsBrowseLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: StatsHit[]; total: number; loadingMore: boolean; moreError: string | null; loadMore: () => void };

type BrowseState =
  | { key: string; status: 'error'; message: string }
  | { key: string; status: 'ready'; items: StatsHit[]; total: number; page: number; loadingMore: boolean; moreError: string | null };

const BROWSE_FAILED = 'Couldn’t load the list. Check your connection and try again.';

function browseFailure(error: unknown): string {
  return apiErrorStatus(error) === 429 ? BUSY : BROWSE_FAILED;
}

/**
 * The browsable list for one kind: the first page loads straight away, `loadMore` adds the next. Words of two or
 * more letters narrow the list once typing pauses (`delayMs`), so each letter doesn't cost a request. An older reply
 * never replaces a newer one: a new kind or words abort the last request and start again from page one.
 */
export function useStatsBrowse(kind: StatsSubjectKind, query: string, delayMs = 350): StatsBrowseLoad {
  const q = tidyStatsQuery(query);
  const text = isSearchableQuery(q) ? q : '';
  const key = `${kind}|${text}`;
  const [state, setState] = useState<BrowseState | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api.get<unknown>('/stats/browse', { params: { kind, q: text || undefined, page: 1 }, signal: controller.signal })
        .then(({ data }) => {
          if (controller.signal.aborted) return;
          setState(isStatsBrowse(data)
            ? { key, status: 'ready', items: data.items, total: data.total, page: data.page, loadingMore: false, moreError: null }
            : { key, status: 'error', message: 'The list isn’t available right now.' });
        })
        .catch((error) => { if (!controller.signal.aborted) setState({ key, status: 'error', message: browseFailure(error) }); });
    }, text ? delayMs : 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [kind, text, key, delayMs]);

  function loadMore() {
    if (state?.key !== key || state.status !== 'ready' || state.loadingMore) return;
    const next = state.page + 1;
    const stillHere = (current: BrowseState | null): current is Extract<BrowseState, { status: 'ready' }> =>
      current?.key === key && current.status === 'ready';
    setState({ ...state, loadingMore: true, moreError: null });
    api.get<unknown>('/stats/browse', { params: { kind, q: text || undefined, page: next } })
      .then(({ data }) => setState((current) => {
        if (!stillHere(current)) return current;
        if (!isStatsBrowse(data)) return { ...current, loadingMore: false, moreError: 'The next page isn’t available right now.' };
        const seen = new Set(current.items.map((item) => item.key));
        return { ...current, items: [...current.items, ...data.items.filter((item) => !seen.has(item.key))], total: data.total, page: next, loadingMore: false };
      }))
      .catch((error) => setState((current) => stillHere(current) ? { ...current, loadingMore: false, moreError: browseFailure(error) } : current));
  }

  if (state?.key !== key) return { status: 'loading' };
  if (state.status === 'error') return { status: 'error', message: state.message };
  return { status: 'ready', items: state.items, total: state.total, loadingMore: state.loadingMore, moreError: state.moreError, loadMore };
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
