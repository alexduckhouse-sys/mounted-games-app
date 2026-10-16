import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';

vi.mock('../api', () => ({ api: { get: vi.fn() } }));
const get = vi.mocked(api.get);

const reply = (data: unknown, headers: Record<string, unknown> = {}) => get.mockResolvedValue({ data, headers });
// The request cache lives in the module and reads the clock it was created with, so each test gets a fresh
// module created while the fake clock is already installed.
const lat = 51.5;
let getWeather: typeof import('./weather').getWeather;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
  vi.resetModules();
  ({ getWeather } = await import('./weather'));
});
afterEach(() => { vi.useRealTimers(); });

describe('getWeather', () => {
  it('returns the response body', async () => {
    reply({ current: { temperature_2m: 18 } });
    await expect(getWeather('/weather/current', { lat, lon: 2 })).resolves.toEqual({ current: { temperature_2m: 18 } });
    expect(get).toHaveBeenCalledWith('/weather/current', { params: { lat, lon: 2 } });
  });

  it('shares one request between callers with the same parameters, whatever their order', async () => {
    reply({ ok: 1 });
    await Promise.all([
      getWeather('/weather/current', { lat, lon: 2 }),
      getWeather('/weather/current', { lon: 2, lat }),
    ]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('asks again for different parameters or a different path', async () => {
    reply({ ok: 1 });
    await getWeather('/weather/current', { lat, lon: 2 });
    await getWeather('/weather/current', { lat, lon: 3 });
    await getWeather('/weather/at', { lat, lon: 2 });
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('refreshes after thirty minutes', async () => {
    reply({ ok: 1 });
    await getWeather('/weather/current', { lat, lon: 2 });
    vi.advanceTimersByTime(29 * 60_000);
    await getWeather('/weather/current', { lat, lon: 2 });
    expect(get).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    await getWeather('/weather/current', { lat, lon: 2 });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['an error from the forecast service', { error: 'upstream' }],
    ['a fallback forecast', { fallback: { temperature_2m: 10 } }],
  ])('treats %s as unavailable', async (_label, body) => {
    reply(body);
    await expect(getWeather('/weather/current', { lat, lon: 2 })).rejects.toThrow('Weather is unavailable');
  });

  it('passes network failures on', async () => {
    get.mockRejectedValue(new Error('offline'));
    await expect(getWeather('/weather/current', { lat, lon: 2 })).rejects.toThrow('offline');
  });

  describe('saved copies from the service worker', () => {
    const savedAt = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

    it('accepts a recent saved copy', async () => {
      reply({ ok: 1 }, { 'x-mg-saved-copy': '1', 'x-mg-saved-at': savedAt(29) });
      await expect(getWeather('/weather/current', { lat, lon: 2 })).resolves.toEqual({ ok: 1 });
    });

    it('rejects a copy saved thirty minutes ago or more', async () => {
      reply({ ok: 1 }, { 'x-mg-saved-copy': '1', 'x-mg-saved-at': savedAt(30) });
      await expect(getWeather('/weather/current', { lat, lon: 2 })).rejects.toThrow('Saved weather is out of date');
    });

    it.each([
      ['no save time', {}],
      ['an unreadable save time', { 'x-mg-saved-at': 'whenever' }],
    ])('rejects a copy with %s', async (_label, extra) => {
      reply({ ok: 1 }, { 'x-mg-saved-copy': '1', ...extra });
      await expect(getWeather('/weather/current', { lat, lon: 2 })).rejects.toThrow('Saved weather is out of date');
    });

    it('does not check the age of a live response', async () => {
      reply({ ok: 1 }, { 'x-mg-saved-at': savedAt(600) });
      await expect(getWeather('/weather/current', { lat, lon: 2 })).resolves.toEqual({ ok: 1 });
    });
  });
});
