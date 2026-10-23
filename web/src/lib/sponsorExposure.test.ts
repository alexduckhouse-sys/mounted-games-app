import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { flushSponsorExposure, flushSponsorExposureOnLeave, recordSponsorSeconds, recordSponsorView, resetSponsorExposure } from './sponsorExposure';

vi.mock('../api', () => ({ api: { post: vi.fn() } }));

type Batch = { items: { sponsorId: number; placement: number; views: number; seconds: number }[] };
const sent = () => vi.mocked(api.post).mock.calls.map(([url, body]) => ({ url, items: (body as Batch).items }));

beforeEach(() => {
  vi.useFakeTimers();
  resetSponsorExposure();
  vi.mocked(api.post).mockResolvedValue({ data: null });
});
afterEach(() => { vi.useRealTimers(); });

describe('sponsor exposure counts', () => {
  it('adds up views and seconds per sponsor and place, and sends them in one batch', async () => {
    recordSponsorView(7, 1, 'Timetable');
    recordSponsorView(7, 1, 'Timetable');
    recordSponsorView(7, 2, 'BreakStream');
    recordSponsorSeconds(7, 2, 'BreakStream', 1);
    recordSponsorSeconds(7, 2, 'BreakStream', 1);
    await flushSponsorExposure();
    expect(sent()).toEqual([{ url: '/competitions/7/sponsors/exposures', items: [
      { sponsorId: 1, placement: 1, views: 2, seconds: 0 },
      { sponsorId: 2, placement: 16, views: 1, seconds: 2 },
    ] }]);
  });

  it('sends on its own after half a minute, and only once', async () => {
    recordSponsorView(7, 1, 'Details');
    recordSponsorView(7, 1, 'Details');
    await vi.advanceTimersByTimeAsync(29_000);
    expect(api.post).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sent()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent()).toHaveLength(1);
  });

  it('sends nothing when nothing was shown', async () => {
    await flushSponsorExposure();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('keeps each competition in its own batch', async () => {
    recordSponsorView(1, 1, 'Results');
    recordSponsorView(2, 9, 'Results');
    await flushSponsorExposure();
    expect(sent().map((call) => call.url)).toEqual(['/competitions/1/sponsors/exposures', '/competitions/2/sponsors/exposures']);
  });

  it('splits what is over the API’s limits instead of losing it', async () => {
    for (let i = 0; i < 41; i += 1) recordSponsorView(1, i + 1, 'Stream');
    recordSponsorSeconds(1, 100, 'Stream', 3601);
    await flushSponsorExposure();
    const batches = sent();
    expect(batches.map((b) => b.items.length)).toEqual([40, 3]);
    const all = batches.flatMap((b) => b.items);
    expect(all.filter((i) => i.sponsorId === 100).map((i) => i.seconds)).toEqual([3600, 1]);
    expect(all.every((i) => i.views <= 500 && i.seconds <= 3600)).toBe(true);

    vi.mocked(api.post).mockClear();
    for (let i = 0; i < 501; i += 1) recordSponsorView(1, 5, 'Stream');
    await flushSponsorExposure();
    expect(sent()[0].items.map((i) => i.views)).toEqual([500, 1]);
  });

  it('tries a failed send again, but not one the server refused', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('no signal'));
    recordSponsorView(1, 1, 'Timetable');
    await flushSponsorExposure();
    recordSponsorView(1, 1, 'Timetable');
    await vi.advanceTimersByTimeAsync(31_000);
    expect(sent()[1].items).toEqual([{ sponsorId: 1, placement: 1, views: 2, seconds: 0 }]);

    vi.mocked(api.post).mockClear();
    vi.mocked(api.post).mockRejectedValueOnce({ response: { status: 429 } });
    recordSponsorView(1, 1, 'Timetable');
    await flushSponsorExposure();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(api.post).toHaveBeenCalledTimes(1);

    vi.mocked(api.post).mockClear();
    vi.mocked(api.post).mockRejectedValueOnce({ response: { status: 503 } });
    recordSponsorView(1, 1, 'Results');
    await flushSponsorExposure();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(api.post).toHaveBeenCalledTimes(2);
  });

  it('holds a limited number of different counts if the connection stays down', async () => {
    for (let i = 0; i < 250; i += 1) recordSponsorView(1, i + 1, 'Timetable');
    await flushSponsorExposure();
    expect(sent().flatMap((b) => b.items)).toHaveLength(200);
  });

  it('uses the browser’s beacon when the page is going away', async () => {
    const beacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon });
    recordSponsorView(3, 4, 'Results');
    await flushSponsorExposure(true);
    expect(api.post).not.toHaveBeenCalled();
    const [url, blob] = beacon.mock.calls[0] as unknown as [string, Blob];
    expect(url).toBe('/api/competitions/3/sponsors/exposures');
    expect(blob.type).toBe('application/json');
    expect(JSON.parse(await blob.text())).toEqual({ items: [{ sponsorId: 4, placement: 2, views: 1, seconds: 0 }] });
  });

  it('keeps the counts if the beacon is refused, and posts normally when there is no beacon', async () => {
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: vi.fn(() => false) });
    recordSponsorView(3, 4, 'Results');
    await flushSponsorExposure(true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: undefined });
    await flushSponsorExposure(true);
    expect(sent()).toEqual([{ url: '/competitions/3/sponsors/exposures', items: [{ sponsorId: 4, placement: 2, views: 1, seconds: 0 }] }]);
  });

  it('sends when the page is hidden, and stops listening when asked', async () => {
    const stop = flushSponsorExposureOnLeave();
    recordSponsorView(1, 1, 'Timetable');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(api.post).not.toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(api.post).toHaveBeenCalledTimes(1);

    stop();
    recordSponsorView(1, 1, 'Timetable');
    window.dispatchEvent(new Event('pagehide'));
    expect(api.post).toHaveBeenCalledTimes(1);
    delete (document as { visibilityState?: unknown }).visibilityState;
  });
});
