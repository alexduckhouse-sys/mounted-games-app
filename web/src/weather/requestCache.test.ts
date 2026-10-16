import { describe, expect, it, vi } from 'vitest';
import { createRequestCache, forecastHour, WEATHER_REFRESH_MS } from './requestCache';

function setup() {
  let clock = 1_000;
  const request = createRequestCache(() => clock);
  return { request, advance: (ms: number) => { clock += ms; } };
}

describe('createRequestCache', () => {
  it('shares one in-flight request between callers with the same key', async () => {
    const { request } = setup();
    const fetcher = vi.fn().mockResolvedValue('sunny');
    const [a, b] = await Promise.all([request('k', fetcher), request('k', fetcher)]);
    expect([a, b]).toEqual(['sunny', 'sunny']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps separate entries for separate keys', async () => {
    const { request } = setup();
    const fetcher = vi.fn().mockImplementation(async () => 'x');
    await request('a', fetcher);
    await request('b', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('reuses a result until the refresh interval has passed', async () => {
    const { request, advance } = setup();
    const fetcher = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');
    expect(await request('k', fetcher)).toBe('first');
    advance(WEATHER_REFRESH_MS - 1);
    expect(await request('k', fetcher)).toBe('first');
    advance(1);
    expect(await request('k', fetcher)).toBe('second');
  });

  it('reuses a failure only briefly so the forecast service is not hammered', async () => {
    const { request, advance } = setup();
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce('back');
    await expect(request('k', fetcher)).rejects.toThrow('down');
    advance(59_000);
    await expect(request('k', fetcher)).rejects.toThrow('down');
    expect(fetcher).toHaveBeenCalledTimes(1);
    advance(1_001);
    expect(await request('k', fetcher)).toBe('back');
  });

  it('turns a synchronous throw in the fetcher into a rejection', async () => {
    const { request } = setup();
    await expect(request('k', () => { throw new Error('sync'); })).rejects.toThrow('sync');
  });

  it('forgets the oldest entries beyond 128 keys', async () => {
    const { request } = setup();
    const fetcher = vi.fn().mockImplementation(async () => 'x');
    for (let i = 0; i < 129; i++) await request(`k${i}`, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(129);
    await request('k128', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(129);
    await request('k0', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(130);
  });

  it('defaults to the real clock', async () => {
    const request = createRequestCache();
    const fetcher = vi.fn().mockResolvedValue(1);
    await request('k', fetcher);
    await request('k', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('forecastHour', () => {
  it('rounds down to the start of the UTC hour', () => {
    expect(forecastHour('2026-06-01T10:45:30.123Z')).toBe('2026-06-01T10:00:00.000Z');
    expect(forecastHour(new Date('2026-06-01T23:59:59Z'))).toBe('2026-06-01T23:00:00.000Z');
  });

  it('returns an empty string for an invalid date', () => {
    expect(forecastHour('soon')).toBe('');
  });
});
