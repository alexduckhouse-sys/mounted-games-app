import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchEmbedJson, useEmbedResource } from './useEmbedResource';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const isNumber = (value: unknown): value is { n: number } => typeof value === 'object' && value !== null && typeof (value as { n?: unknown }).n === 'number';
const setNetwork = (online: boolean) => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
const flush = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

describe('useEmbedResource edge cases', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (document as unknown as Record<string, unknown>).visibilityState;
    delete (navigator as unknown as Record<string, unknown>).onLine;
  });

  it('treats an answer with no content type as not data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    await expect(fetchEmbedJson('/x')).rejects.toMatchObject({ status: 404 });
  });

  it('does not resume from an online event until the browser agrees it is online', async () => {
    setNetwork(false);
    const fetchMock = vi.fn().mockImplementation(async () => json({ n: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    renderHook(() => useEmbedResource('/x', isNumber, () => 10_000));
    await flush();
    act(() => { window.dispatchEvent(new Event('online')); });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    setNetwork(true);
    act(() => { window.dispatchEvent(new Event('online')); });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not start a second check while one is already scheduled', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json({ n: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    renderHook(() => useEmbedResource('/x', isNumber, () => 10_000));
    await flush();
    act(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('online')); });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cancels the waiting timer on unmount', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json({ n: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = renderHook(() => useEmbedResource('/x', isNumber, () => 10_000));
    await flush();
    unmount();
    await advance(600_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ignores an answer that arrives after unmount', async () => {
    let finish: (response: Response) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; })));
    const interval = vi.fn(() => 10_000);
    const { result, unmount } = renderHook(() => useEmbedResource('/x', isNumber, interval));
    await flush();
    unmount();
    await act(async () => { finish(json({ n: 1 })); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.data).toBeNull();
    expect(interval).not.toHaveBeenCalled();
  });

  it('ignores a failure that arrives after unmount', async () => {
    let fail: (reason: unknown) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>((_resolve, reject) => { fail = reject; })));
    const interval = vi.fn(() => 10_000);
    const { result, unmount } = renderHook(() => useEmbedResource('/x', isNumber, interval));
    await flush();
    unmount();
    await act(async () => { fail(new TypeError('late')); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.error).toBeNull();
    expect(interval).not.toHaveBeenCalled();
  });

  it('uses the latest interval function without restarting', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const fetchMock = vi.fn().mockImplementation(async () => json({ n: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = renderHook(({ ms }) => useEmbedResource('/x', isNumber, () => ms), { initialProps: { ms: 10_000 } });
    await flush();
    rerender({ ms: 20_000 });
    await advance(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await advance(19_999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.restoreAllMocks();
  });
});
