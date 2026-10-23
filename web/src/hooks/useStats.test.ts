import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { useStatsProfile, useStatsSearch } from './useStats';

vi.mock('../api', () => ({ api: { get: vi.fn() } }));

const search = (query: string) => ({ query, riders: [{ kind: 0, name: 'Oliver S.', key: 'oliver s.', competitions: 2 }], ponies: [], teams: [], clubs: [] });
const profile = {
  kind: 0, name: 'Oliver S.', key: 'oliver s.', detailed: false, raceFiguresAllFormats: false,
  summary: { entries: 1 }, games: null, bestGames: null, worstGames: null, entries: null, partnerships: null,
};
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('useStatsSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(api.get).mockImplementation(async (_url, config) => ({ data: search(String((config?.params as { q: string }).q)) }));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('stays idle until there are two letters, then searches once typing pauses', async () => {
    const { result, rerender } = renderHook(({ q }) => useStatsSearch(q, 300), { initialProps: { q: 'o' } });
    expect(result.current).toEqual({ status: 'idle' });

    rerender({ q: 'ol' });
    expect(result.current.status).toBe('loading');
    rerender({ q: ' oli  ' });
    await act(async () => { vi.advanceTimersByTime(299); await flush(); });
    expect(api.get).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); await flush(); });
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/stats/search', expect.objectContaining({ params: { q: 'oli' } }));
    expect(result.current).toEqual({ status: 'ready', data: search('oli') });

    rerender({ q: '' });
    expect(result.current).toEqual({ status: 'idle' });
  });

  it('ignores the reply to a query that has since changed', async () => {
    let finish: (value: unknown) => void = () => {};
    vi.mocked(api.get).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { result, rerender } = renderHook(({ q }) => useStatsSearch(q, 10), { initialProps: { q: 'old' } });
    await act(async () => { vi.advanceTimersByTime(10); await flush(); });
    rerender({ q: 'new' });
    await act(async () => { finish({ data: search('old') }); await flush(); });
    expect(result.current.status).toBe('loading');
    await act(async () => { vi.advanceTimersByTime(10); await flush(); });
    expect(result.current).toEqual({ status: 'ready', data: search('new') });
  });

  it.each([
    [httpError(429), 'Too many searches in a minute. Wait a moment and try again.'],
    [new Error('offline'), 'Couldn’t search. Check your connection and try again.'],
  ])('explains a failed search', async (error, message) => {
    vi.mocked(api.get).mockRejectedValueOnce(error);
    const { result } = renderHook(() => useStatsSearch('oliver', 0));
    await act(async () => { vi.advanceTimersByTime(0); await flush(); });
    expect(result.current).toEqual({ status: 'error', message });
  });

  it('treats a reply that is not a search as an error', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: '<!doctype html>' });
    const { result } = renderHook(() => useStatsSearch('oliver', 0));
    await act(async () => { vi.advanceTimersByTime(0); await flush(); });
    expect(result.current).toEqual({ status: 'error', message: 'Search isn’t available right now.' });
  });

  it('drops a reply that arrives after unmounting', async () => {
    let finish: (value: unknown) => void = () => {};
    vi.mocked(api.get).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { unmount } = renderHook(() => useStatsSearch('oliver', 0));
    await act(async () => { vi.advanceTimersByTime(0); await flush(); });
    unmount();
    await act(async () => { finish({ data: search('oliver') }); await flush(); });
    const signal = (vi.mocked(api.get).mock.calls[0][1] as { signal: AbortSignal }).signal;
    expect(signal.aborted).toBe(true);
  });

  it('drops a failure that arrives after unmounting', async () => {
    let fail: (error: unknown) => void = () => {};
    vi.mocked(api.get).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    const { result, unmount } = renderHook(() => useStatsSearch('oliver', 0));
    await act(async () => { vi.advanceTimersByTime(0); await flush(); });
    unmount();
    await act(async () => { fail(new Error('aborted')); await flush(); });
    expect(result.current.status).toBe('loading');
  });
});

describe('useStatsProfile', () => {
  beforeEach(() => { vi.mocked(api.get).mockResolvedValue({ data: profile }); });

  it('loads nothing without a URL', () => {
    const { result } = renderHook(() => useStatsProfile(null));
    expect(result.current).toEqual({ status: 'idle' });
    expect(api.get).not.toHaveBeenCalled();
  });

  it('loads a profile and reloads when the key changes', async () => {
    const { result, rerender } = renderHook(({ key }) => useStatsProfile('/stats/riders?name=oliver%20s.', key), { initialProps: { key: 'public' } });
    expect(result.current.status).toBe('loading');
    await act(flush);
    expect(result.current).toEqual({ status: 'ready', data: profile });
    rerender({ key: 'user-1' });
    expect(result.current.status).toBe('loading');
    await act(flush);
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('ready');
  });

  it.each([
    [httpError(404), { status: 'missing' }],
    [httpError(429), { status: 'error', message: 'Too many searches in a minute. Wait a moment and try again.' }],
    [new Error('offline'), { status: 'error', message: 'Couldn’t load these statistics. Check your connection and try again.' }],
  ])('maps a failure to a state', async (error, expected) => {
    vi.mocked(api.get).mockRejectedValueOnce(error);
    const { result } = renderHook(() => useStatsProfile('/stats/ponies?name=bramble'));
    await act(flush);
    expect(result.current).toEqual(expected);
  });

  it('treats a reply that is not a profile as an error', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: { name: 'x' } });
    const { result } = renderHook(() => useStatsProfile('/stats/teams?name=north'));
    await act(flush);
    expect(result.current).toEqual({ status: 'error', message: 'Statistics aren’t available right now.' });
  });

  it('ignores replies after unmounting', async () => {
    let finish: (value: unknown) => void = () => {};
    let fail: (error: unknown) => void = () => {};
    vi.mocked(api.get)
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    const first = renderHook(() => useStatsProfile('/stats/clubs?name=north'));
    const second = renderHook(() => useStatsProfile('/stats/clubs?name=south'));
    first.unmount();
    second.unmount();
    await act(async () => { finish({ data: profile }); fail(new Error('aborted')); await flush(); });
    expect(first.result.current.status).toBe('loading');
    expect(second.result.current.status).toBe('loading');
  });
});
