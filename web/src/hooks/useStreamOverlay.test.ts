import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { DEFAULT_OVERLAY } from '../lib/overlays';
import { useStreamOverlay } from './useStreamOverlay';

vi.mock('../api', () => ({ api: { get: vi.fn(), put: vi.fn() } }));

const overlay = (revision: number, bannerText: string | null = null) => ({ ...DEFAULT_OVERLAY, revision, bannerText });

beforeEach(() => {
  vi.mocked(api.get).mockResolvedValue({ data: overlay(2, 'From the server') });
});

describe('useStreamOverlay', () => {
  it('loads the overlays and ignores an answer that is not an overlay', async () => {
    const { result } = renderHook(() => useStreamOverlay(1, 0));
    await waitFor(() => expect(result.current.overlay.bannerText).toBe('From the server'));
    expect(api.get).toHaveBeenCalledWith('/competitions/1/overlays', expect.anything());

    vi.mocked(api.get).mockResolvedValue({ data: '<!doctype html>' });
    const other = renderHook(() => useStreamOverlay(2, 0));
    await act(async () => {});
    expect(other.result.current.overlay).toEqual(DEFAULT_OVERLAY);
  });

  it('keeps the newest revision, whichever arrives first', async () => {
    let answer!: (value: { data: unknown }) => void;
    vi.mocked(api.get).mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    const { result } = renderHook(() => useStreamOverlay(1, 0));

    act(() => result.current.onOverlayUpdated(overlay(5, 'Live update')));
    act(() => result.current.onOverlayUpdated('nonsense'));
    await act(async () => { answer({ data: overlay(4, 'Slow snapshot') }); });

    expect(result.current.overlay).toMatchObject({ revision: 5, bannerText: 'Live update' });
  });

  it('keeps what it has when loading fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('no signal'));
    const { result } = renderHook(() => useStreamOverlay(1, 0));
    await act(async () => {});
    expect(result.current.overlay).toEqual(DEFAULT_OVERLAY);
  });

  it('saves a change with the revision it last saw', async () => {
    vi.mocked(api.put).mockResolvedValue({ data: overlay(3, 'Lunch') });
    const { result } = renderHook(() => useStreamOverlay(1, 0));
    await waitFor(() => expect(result.current.overlay.revision).toBe(2));

    let outcome;
    await act(async () => { outcome = await result.current.save((o) => ({ ...o, bannerText: 'Lunch' })); });

    expect(outcome).toBe('saved');
    expect(api.put).toHaveBeenCalledWith('/competitions/1/overlays', expect.objectContaining({ bannerText: 'Lunch', expectedRevision: 2 }));
    expect(result.current.overlay).toMatchObject({ revision: 3, bannerText: 'Lunch' });
  });

  it('takes the server copy when someone else saved first', async () => {
    vi.mocked(api.put).mockRejectedValue({ response: { status: 409, data: overlay(6, 'Theirs') } });
    const { result } = renderHook(() => useStreamOverlay(1, 0));
    await waitFor(() => expect(result.current.overlay.revision).toBe(2));

    let outcome;
    await act(async () => { outcome = await result.current.save((o) => ({ ...o, bannerText: 'Mine' })); });

    expect(outcome).toBe('conflict');
    expect(result.current.overlay).toMatchObject({ revision: 6, bannerText: 'Theirs' });
  });

  it('reports other failures and keeps the current overlays', async () => {
    vi.mocked(api.put).mockRejectedValue(new Error('no signal'));
    const { result } = renderHook(() => useStreamOverlay(1, 0));
    await waitFor(() => expect(result.current.overlay.revision).toBe(2));

    let outcome;
    await act(async () => { outcome = await result.current.save((o) => ({ ...o, bannerText: 'Mine' })); });
    expect(outcome).toBe('failed');

    vi.mocked(api.put).mockRejectedValue({ response: { status: 409, data: 'garbled' } });
    await act(async () => { outcome = await result.current.save((o) => o); });
    expect(outcome).toBe('conflict');

    vi.mocked(api.put).mockResolvedValue({ data: 'garbled' });
    await act(async () => { outcome = await result.current.save((o) => o); });
    expect(outcome).toBe('saved');
    expect(result.current.overlay).toMatchObject({ revision: 2, bannerText: 'From the server' });
  });
});
