import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { useStatsBrowse, useStatsProfile } from './useStats';

vi.mock('../api', () => ({ api: { get: vi.fn() } }));

const hit = (name: string) => ({ kind: 0, name, key: name.toLowerCase(), competitions: 2 });
const page = (names: string[], overrides: Record<string, unknown> = {}) => ({ kind: 0, query: '', page: 1, pageSize: 2, total: names.length, items: names.map(hit), ...overrides });
const profile = {
  kind: 0, name: 'Oliver S.', key: 'oliver s.', detailed: false, raceFiguresAllFormats: false,
  summary: { entries: 1 }, games: null, bestGames: null, worstGames: null, entries: null, partnerships: null,
};
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('useStatsBrowse', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('lists the first page straight away, with no words typed', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: page(['Ann', 'Bea']) });
    const { result } = renderHook(() => useStatsBrowse(0, '', 300));
    expect(result.current).toEqual({ status: 'loading' });
    await act(async () => { vi.advanceTimersByTime(0); await flush(); });
    expect(api.get).toHaveBeenCalledWith('/stats/browse', expect.objectContaining({ params: { kind: 0, q: undefined, page: 1 } }));
    expect(result.current).toMatchObject({ status: 'ready', total: 2, loadingMore: false, moreError: null });
  });

  it('waits for typing to pause, ignores a single letter, and starts again on a new kind', async () => {
    vi.mocked(api.get).mockImplementation(async (_url, config) => {
      const { q, kind } = config?.params as { q?: string; kind: number };
      return { data: page([`${q ?? 'all'}-${kind}`]) };
    });
    const { result, rerender } = renderHook(({ kind, q }) => useStatsBrowse(kind, q, 300), { initialProps: { kind: 0 as 0 | 1, q: '' } });
    await act(async () => { vi.advanceTimersByTime(0); await flush(); });
    rerender({ kind: 0, q: 'o' });
    await act(async () => { vi.advanceTimersByTime(0); await flush(); });
    expect(api.get).toHaveBeenCalledTimes(1);

    rerender({ kind: 0, q: ' oli  ' });
    expect(result.current.status).toBe('loading');
    await act(async () => { vi.advanceTimersByTime(299); await flush(); });
    expect(api.get).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(1); await flush(); });
    expect(api.get).toHaveBeenLastCalledWith('/stats/browse', expect.objectContaining({ params: { kind: 0, q: 'oli', page: 1 } }));
    expect(result.current).toMatchObject({ status: 'ready', items: [hit('oli-0')] });

    rerender({ kind: 1, q: 'oli' });
    expect(result.current.status).toBe('loading');
    await act(async () => { vi.advanceTimersByTime(300); await flush(); });
    expect(result.current).toMatchObject({ status: 'ready', items: [hit('oli-1')] });
  });

  it('ignores the reply to a list that has since changed', async () => {
    let finish: (value: unknown) => void = () => {};
    vi.mocked(api.get).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    vi.mocked(api.get).mockResolvedValueOnce({ data: page(['Newer']) });
    const { result, rerender } = renderHook(({ q }) => useStatsBrowse(0, q, 10), { initialProps: { q: 'old' } });
    await act(async () => { vi.advanceTimersByTime(10); await flush(); });
    rerender({ q: 'new' });
    await act(async () => { finish({ data: page(['Older']) }); await flush(); });
    expect(result.current.status).toBe('loading');
    await act(async () => { vi.advanceTimersByTime(10); await flush(); });
    expect(result.current).toMatchObject({ status: 'ready', items: [hit('Newer')] });
  });

  it('loads more pages, skipping names it already has', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: page(['Ann', 'Bea'], { total: 4 }) })
      .mockResolvedValueOnce({ data: page(['Bea', 'Cat'], { page: 2, total: 4 }) });
    const { result } = renderHook(() => useStatsBrowse(0, '', 0));
    await act(async () => { vi.advanceTimersByTime(0); await flush(); });
    const first = result.current as Extract<typeof result.current, { status: 'ready' }>;
    act(() => { first.loadMore(); });
    expect(result.current).toMatchObject({ status: 'ready', loadingMore: true });
    // A second press while loading does nothing.
    act(() => { (result.current as typeof first).loadMore(); });
    await act(async () => { await flush(); });
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(api.get).toHaveBeenLastCalledWith('/stats/browse', expect.objectContaining({ params: { kind: 0, q: undefined, page: 2 } }));
    const done = result.current as typeof first;
    expect(done.items.map((item) => item.name)).toEqual(['Ann', 'Bea', 'Cat']);
    expect(done.loadingMore).toBe(false);
  });

  it.each([
    [httpError(429), 'Too many searches in a minute. Wait a moment and try again.'],
    [new Error('offline'), 'Couldn’t load the list. Check your connection and try again.'],
  ])('explains a failed list', async (error, message) => {
    vi.mocked(api.get).mockRejectedValueOnce(error);
    const { result } = renderHook(() => useStatsBrowse(0, '', 0));
    await act(async () => { vi.advanceTimersByTime(0); await flush(); });
    expect(result.current).toEqual({ status: 'error', message });
  });

  it('treats a reply that is not a list as an error', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: '<!doctype html>' });
    const { result } = renderHook(() => useStatsBrowse(0, '', 0));
    await act(async () => { vi.advanceTimersByTime(0); await flush(); });
    expect(result.current).toEqual({ status: 'error', message: 'The list isn’t available right now.' });
  });

  it('keeps the list and says so when a later page fails or is not a list', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: page(['Ann', 'Bea'], { total: 6 }) })
      .mockRejectedValueOnce(httpError(429))
      .mockResolvedValueOnce({ data: 'nope' });
    const { result } = renderHook(() => useStatsBrowse(0, '', 0));
    await act(async () => { vi.advanceTimersByTime(0); await flush(); });
    type Ready = Extract<typeof result.current, { status: 'ready' }>;
    await act(async () => { (result.current as Ready).loadMore(); await flush(); });
    expect(result.current).toMatchObject({ loadingMore: false, moreError: 'Too many searches in a minute. Wait a moment and try again.' });
    expect((result.current as Ready).items).toHaveLength(2);
    await act(async () => { (result.current as Ready).loadMore(); await flush(); });
    expect(result.current).toMatchObject({ moreError: 'The next page isn’t available right now.' });
  });

  it('drops a later page that arrives after the list changed, or after unmounting', async () => {
    let finish: (value: unknown) => void = () => {};
    let fail: (error: unknown) => void = () => {};
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: page(['Ann', 'Bea'], { total: 6 }) })
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce({ data: page(['Zed']) });
    const { result, rerender } = renderHook(({ kind }) => useStatsBrowse(kind, '', 0), { initialProps: { kind: 0 as 0 | 1 } });
    await act(async () => { vi.advanceTimersByTime(0); await flush(); });
    type Ready = Extract<typeof result.current, { status: 'ready' }>;
    act(() => { (result.current as Ready).loadMore(); });
    rerender({ kind: 1 });
    await act(async () => { vi.advanceTimersByTime(0); await flush(); });
    await act(async () => { finish({ data: page(['Late'], { page: 2 }) }); await flush(); });
    expect((result.current as Ready).items).toEqual([hit('Zed')]);

    // A failure of the older page is dropped too.
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: page(['Ann', 'Bea'], { total: 6 }) })
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    rerender({ kind: 0 });
    await act(async () => { vi.advanceTimersByTime(0); await flush(); });
    act(() => { (result.current as Ready).loadMore(); });
    rerender({ kind: 1 });
    await act(async () => { fail(new Error('offline')); await flush(); });
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
