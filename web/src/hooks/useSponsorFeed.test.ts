import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import * as exposure from '../lib/sponsorExposure';
import { useSponsorFeed } from './useSponsorFeed';

vi.mock('../api', () => ({ api: { get: vi.fn() } }));
vi.mock('../lib/sponsorExposure', () => ({ flushSponsorExposure: vi.fn(async () => {}), flushSponsorExposureOnLeave: vi.fn(() => vi.fn()) }));

const wire = (id: number) => ({ id, name: `Sponsor ${id}`, linkUrl: null, logoUrl: null, tier: 1, sortOrder: id, showOn: 1 });

beforeEach(() => {
  vi.mocked(api.get).mockResolvedValue({ data: [wire(1)] });
  vi.mocked(exposure.flushSponsorExposureOnLeave).mockReturnValue(vi.fn());
});

describe('useSponsorFeed', () => {
  it('loads the public list', async () => {
    const { result } = renderHook(() => useSponsorFeed(5, 0));
    expect(result.current.sponsors).toEqual([]);
    await waitFor(() => expect(result.current.sponsors.map((s) => s.id)).toEqual([1]));
    expect(api.get).toHaveBeenCalledWith('/competitions/5/sponsors', expect.anything());
  });

  it('treats an answer that is not a list as no sponsors', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: '<!doctype html>' });
    const { result } = renderHook(() => useSponsorFeed(5, 0));
    await act(async () => {});
    expect(result.current.sponsors).toEqual([]);
  });

  it('keeps what it has when a refresh fails, and fetches again on a rejoin or a reload', async () => {
    const { result, rerender } = renderHook(({ ready }) => useSponsorFeed(5, ready), { initialProps: { ready: 0 } });
    await waitFor(() => expect(result.current.sponsors).toHaveLength(1));
    vi.mocked(api.get).mockRejectedValue(new Error('no signal'));
    rerender({ ready: 1 });
    await act(async () => {});
    expect(result.current.sponsors).toHaveLength(1);

    vi.mocked(api.get).mockResolvedValue({ data: [wire(1), wire(2)] });
    act(() => result.current.reloadSponsors());
    await waitFor(() => expect(result.current.sponsors).toHaveLength(2));
  });

  it('does not show one competition’s sponsors on another', async () => {
    const { result, rerender } = renderHook(({ id }) => useSponsorFeed(id, 0), { initialProps: { id: 5 } });
    await waitFor(() => expect(result.current.sponsors).toHaveLength(1));
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    rerender({ id: 6 });
    expect(result.current.sponsors).toEqual([]);
  });

  it('counts the producer’s skips and ignores anything else', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1234);
    const { result } = renderHook(() => useSponsorFeed(5, 0));
    expect(result.current.sponsorSkip).toEqual({ count: 0, at: 0 });
    act(() => result.current.onSponsorControl({ action: 'skip' }));
    act(() => result.current.onSponsorControl({ action: 'other' }));
    expect(result.current.sponsorSkip).toEqual({ count: 1, at: 1234 });
  });

  it('sends the counts when leaving', () => {
    const stop = vi.fn();
    vi.mocked(exposure.flushSponsorExposureOnLeave).mockReturnValue(stop);
    const { unmount } = renderHook(() => useSponsorFeed(5, 0));
    expect(exposure.flushSponsorExposureOnLeave).toHaveBeenCalled();
    unmount();
    expect(stop).toHaveBeenCalled();
    expect(exposure.flushSponsorExposure).toHaveBeenCalled();
  });
});
