import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmbedFetchError, fetchEmbedJson, useEmbedResource } from './useEmbedResource';

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });
const isNumber = (value: unknown): value is { n: number } => typeof value === 'object' && value !== null && typeof (value as { n?: unknown }).n === 'number';

describe('fetchEmbedJson', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends no credentials or sign-in and marks the request as an embed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ n: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('mg.auth', JSON.stringify({ token: 'secret' }));
    await expect(fetchEmbedJson('/competitions/1')).resolves.toEqual({ n: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/competitions/1');
    expect(init.credentials).toBe('omit');
    expect(init.headers['X-MG-Embed']).toBe('1');
    expect(JSON.stringify(init.headers)).not.toContain('secret');
    expect(init.headers.Authorization).toBeUndefined();
  });
  it('turns an error status or a web page into a failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('no', { status: 404 })).mockResolvedValueOnce(new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } })));
    await expect(fetchEmbedJson('/x')).rejects.toMatchObject({ status: 404 });
    await expect(fetchEmbedJson('/x')).rejects.toBeInstanceOf(EmbedFetchError);
  });
  it('stops when the caller aborts', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))))));
    const controller = new AbortController();
    const pending = fetchEmbedJson('/x', controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('aborted');
  });
  it('gives up after the timeout', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('timeout'))))));
      const pending = fetchEmbedJson('/x');
      const assertion = expect(pending).rejects.toThrow('timeout');
      await vi.advanceTimersByTimeAsync(15_001);
      await assertion;
    } finally { vi.useRealTimers(); }
  });
});

describe('useEmbedResource', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  const setVisibility = (state: 'visible' | 'hidden') => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange'));
  };

  it('loads, then polls at the interval it is given', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json({ n: 1 })));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useEmbedResource('/a', isNumber, () => 30_000));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.data).toEqual({ n: 1 });
    expect(result.current.updatedAt).toBeInstanceOf(Date);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(34_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the last data when a refresh fails and counts the failures', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ n: 1 })).mockResolvedValue(new Response('x', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const intervals: number[] = [];
    const { result } = renderHook(() => useEmbedResource('/a', isNumber, (_data, failures) => { intervals.push(failures); return 1_000; }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_200); });
    expect(result.current.data).toEqual({ n: 1 });
    expect(result.current.error).toBe('failed');
    expect(result.current.failures).toBe(1);
    expect(intervals).toContain(1);
  });

  it('reports not found and rejects a wrongly shaped answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 404 })).mockResolvedValueOnce(json({ other: true })));
    const { result } = renderHook(() => useEmbedResource('/a', isNumber, () => 1_000));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.error).toBe('notfound');
    expect(result.current.data).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_200); });
    expect(result.current.error).toBe('failed');
  });

  it('does nothing without a path and starts over when the path changes', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => Promise.resolve(json({ n: url.endsWith('b') ? 2 : 1 })));
    vi.stubGlobal('fetch', fetchMock);
    const { result, rerender } = renderHook(({ path }: { path: string | null }) => useEmbedResource(path, isNumber, () => 60_000), { initialProps: { path: null as string | null } });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchMock).not.toHaveBeenCalled();
    rerender({ path: '/a' });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.data).toEqual({ n: 1 });
    rerender({ path: '/b' });
    expect(result.current.data).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.data).toEqual({ n: 2 });
  });

  it('pauses while hidden and checks again as soon as the frame is visible', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json({ n: 1 })));
    vi.stubGlobal('fetch', fetchMock);
    renderHook(() => useEmbedResource('/a', isNumber, () => 10_000));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    setVisibility('hidden');
    await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('waits while offline and resumes when the device is back online', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json({ n: 1 })));
    vi.stubGlobal('fetch', fetchMock);
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderHook(() => useEmbedResource('/a', isNumber, () => 10_000));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchMock).not.toHaveBeenCalled();
    online.mockReturnValue(true);
    await act(async () => { window.dispatchEvent(new Event('online')); await vi.advanceTimersByTimeAsync(0); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reload checks again straight away', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json({ n: 1 })));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useEmbedResource('/a', isNumber, () => 600_000));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    act(() => result.current.reload());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops polling on unmount', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json({ n: 1 })));
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = renderHook(() => useEmbedResource('/a', isNumber, () => 1_000));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
