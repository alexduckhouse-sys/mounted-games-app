import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { useDayForecast } from './useDayForecast';

vi.mock('../api', () => ({ api: { get: vi.fn() } }));

const body = (code = 95) => ({ utc_offset_seconds: 0, hourly: { time: ['2026-11-02T14:00'], weather_code: [code], precipitation: [0], precipitation_probability: [0] } });
const flush = () => act(async () => { await Promise.resolve(); });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date(2026, 10, 2, 13, 0));
  vi.mocked(api.get).mockResolvedValue({ data: body() });
});
afterEach(() => vi.useRealTimers());

describe('useDayForecast', () => {
  it('fetches today for the place and returns the hours', async () => {
    const { result } = renderHook(() => useDayForecast(51.5, -1.2, true));
    expect(result.current).toBeNull();
    await flush();
    expect(result.current).toHaveLength(1);
    expect(api.get).toHaveBeenCalledWith('/weather/forecast', expect.objectContaining({ params: { lat: 51.5, lon: -1.2, date: '2026-11-02' } }));
  });

  it('does nothing without a place or when switched off', async () => {
    const off = renderHook(() => useDayForecast(51.5, -1.2, false));
    const nowhere = renderHook(() => useDayForecast(null, undefined, true));
    await flush();
    expect(api.get).not.toHaveBeenCalled();
    expect(off.result.current).toBeNull();
    expect(nowhere.result.current).toBeNull();
  });

  it('asks again every ten minutes, and every twenty in lite mode', async () => {
    renderHook(() => useDayForecast(51.5, -1.2, true));
    await flush();
    await act(async () => { vi.advanceTimersByTime(10 * 60_000); });
    expect(api.get).toHaveBeenCalledTimes(2);
    document.documentElement.dataset.lite = 'true';
    renderHook(() => useDayForecast(52, -1, true));
    await flush();
    vi.mocked(api.get).mockClear();
    await act(async () => { vi.advanceTimersByTime(10 * 60_000); });
    expect(api.get).toHaveBeenCalledTimes(1); // only the ordinary hook's poll
    delete document.documentElement.dataset.lite;
  });

  it('keeps the last good forecast through a failed poll, and drops it after an hour', async () => {
    const { result } = renderHook(() => useDayForecast(51.5, -1.2, true));
    await flush();
    vi.mocked(api.get).mockRejectedValue(new Error('no signal'));
    await act(async () => { vi.advanceTimersByTime(10 * 60_000); });
    expect(result.current).toHaveLength(1);
    await act(async () => { vi.advanceTimersByTime(60 * 60_000); });
    expect(result.current).toBeNull();
  });

  it('treats the API fallback answer as no forecast', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { error: 'weather_unavailable', fallback: { weather_code: [3] } } });
    const { result } = renderHook(() => useDayForecast(51.5, -1.2, true));
    await flush();
    expect(result.current).toBeNull();
  });

  it('looks again when the tab comes back after a while, but not straight away', async () => {
    renderHook(() => useDayForecast(51.5, -1.2, true));
    await flush();
    vi.mocked(api.get).mockClear();
    vi.setSystemTime(new Date(2026, 10, 2, 13, 2));
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(api.get).not.toHaveBeenCalled();
    vi.setSystemTime(new Date(2026, 10, 2, 13, 6));
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('does not look while the tab is hidden', async () => {
    renderHook(() => useDayForecast(51.5, -1.2, true));
    await flush();
    vi.mocked(api.get).mockClear();
    vi.setSystemTime(new Date(2026, 10, 2, 14, 0));
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(api.get).not.toHaveBeenCalled();
    hidden.mockRestore();
  });

  it('does not show one place’s forecast for another, and ignores an answer that arrives after it left', async () => {
    let finish: (value: unknown) => void = () => {};
    vi.mocked(api.get).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { result, rerender, unmount } = renderHook(({ lat }) => useDayForecast(lat, -1.2, true), { initialProps: { lat: 51.5 } });
    rerender({ lat: 52 });
    await flush();
    expect(result.current).toHaveLength(1);
    await act(async () => { finish({ data: body(99) }); });
    expect(result.current).toHaveLength(1);
    unmount();
  });
});
