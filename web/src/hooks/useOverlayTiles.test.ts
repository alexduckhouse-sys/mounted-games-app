import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { DEFAULT_OVERLAY } from '../lib/overlays';
import { readCard, readLiveOptions } from '../lib/streamOverlayTiles';
import type { LiveStream, StreamOverlay } from '../types';
import { useOverlayTiles } from './useOverlayTiles';

vi.mock('../api', () => ({ api: { post: vi.fn() } }));

const camera = (extra: Partial<LiveStream> = {}): LiveStream => ({
  id: 7, competitionId: 1, arenaName: 'A', angleName: 'Main', status: 0, caption: null, audioMuted: false, hasAudio: true,
  startedAt: '', viewerCount: 1, generation: 1, ...extra,
});

function setup(opts: { onAir?: LiveStream | null; save?: ReturnType<typeof vi.fn>; overlay?: StreamOverlay; setAutoOn?: (on: boolean) => void } = {}) {
  const overlay = opts.overlay ?? DEFAULT_OVERLAY;
  const changes: StreamOverlay[] = [];
  const saveOverlay = opts.save ?? vi.fn(async (change: (o: StreamOverlay) => StreamOverlay) => { changes.push(change(overlay)); return 'saved' as const; });
  const hook = renderHook((props: { onAir: LiveStream | null }) => useOverlayTiles({ competitionId: 1, overlay, saveOverlay: saveOverlay as never, onAir: props.onAir, setAutoOn: opts.setAutoOn }),
    { initialProps: { onAir: opts.onAir === undefined ? camera() : opts.onAir } });
  return { hook, changes, saveOverlay };
}

describe('useOverlayTiles', () => {
  beforeEach(() => { vi.mocked(api.post).mockReset().mockResolvedValue({ data: {} }); });

  it('picks a card and turns Auto on for Automatic', async () => {
    const setAutoOn = vi.fn();
    const t = setup({ setAutoOn });
    await act(() => t.hook.result.current.pick('heat'));
    expect(readCard(t.changes[0])).toBe('heat');
    expect(setAutoOn).not.toHaveBeenCalled();
    await act(() => t.hook.result.current.pick('auto'));
    expect(readCard(t.changes[1])).toBe('auto');
    expect(setAutoOn).toHaveBeenCalledWith(true);
  });

  it('sends Back soon to the camera on air, and resumes before showing a card', async () => {
    const t = setup();
    await act(() => t.hook.result.current.pick('soon'));
    expect(api.post).toHaveBeenCalledWith('/competitions/1/streams/7/command', { command: 'pause', value: 'true' });
    expect(t.hook.result.current.active).toBe('soon');
    await act(() => t.hook.result.current.pick('soon'));
    expect(api.post).toHaveBeenCalledTimes(1);
    await act(() => t.hook.result.current.pick('toplist'));
    expect(api.post).toHaveBeenLastCalledWith('/competitions/1/streams/7/command', { command: 'pause', value: 'false' });
    expect(readCard(t.changes[0])).toBe('toplist');
    expect(t.hook.result.current.active).not.toBe('soon');
  });

  it('shows Back soon from the camera’s own status and forgets what it sent once that changes', async () => {
    const t = setup({ onAir: camera({ status: 1 }) });
    expect(t.hook.result.current.active).toBe('soon');
    t.hook.rerender({ onAir: camera({ status: 0 }) });
    expect(t.hook.result.current.active).toBe('none');
  });

  it('says so when there is no camera, the phone cannot be reached, or the save fails', async () => {
    const none = setup({ onAir: null });
    await act(() => none.hook.result.current.pick('soon'));
    expect(none.hook.result.current.error).toBe('No camera is live.');

    const t = setup();
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    await act(() => t.hook.result.current.pick('soon'));
    expect(t.hook.result.current.error).toContain('Couldn’t reach the camera phone');

    const conflict = setup({ save: vi.fn().mockResolvedValue('conflict') });
    await act(() => conflict.hook.result.current.pick('heat'));
    expect(conflict.hook.result.current.error).toContain('changed on another phone');
    expect(conflict.hook.result.current.conflict).toBe(true);
    const failed = setup({ save: vi.fn().mockRejectedValue(new Error('x')) });
    await act(() => failed.hook.result.current.pick('heat'));
    expect(failed.hook.result.current.error).toContain('Couldn’t change the overlay');
    const readOnly = renderHook(() => useOverlayTiles({ competitionId: 1, overlay: DEFAULT_OVERLAY, onAir: null }));
    await act(() => readOnly.result.current.pick('heat'));
    expect(readOnly.result.current.error).toBe('You can’t change the overlay from here.');
  });

  it('runs the last change again on retry and clears the conflict flag', async () => {
    const save = vi.fn().mockResolvedValueOnce('conflict').mockResolvedValue('saved');
    const t = setup({ save });
    await act(() => t.hook.result.current.pick('heat'));
    expect(t.hook.result.current.error).not.toBeNull();
    await act(() => t.hook.result.current.retry());
    expect(save).toHaveBeenCalledTimes(2);
    expect(t.hook.result.current.error).toBeNull();
    expect(t.hook.result.current.conflict).toBe(false);
  });

  it('does not resume a paused camera that cannot be reached, and leaves the card alone', async () => {
    const t = setup({ onAir: camera({ status: 1 }) });
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    await act(() => t.hook.result.current.pick('heat'));
    expect(t.saveOverlay).not.toHaveBeenCalled();
  });

  it('saves card settings, steps the podium reveal and posts or clears the banner', async () => {
    const t = setup({ overlay: { ...DEFAULT_OVERLAY, look: { liveOptions: { podiumReveal: 'one', podiumShown: 3 } } } });
    await act(() => t.hook.result.current.setOptions({ toplistRows: 3 }));
    expect(readLiveOptions(t.changes[0]).toplistRows).toBe(3);
    await act(() => t.hook.result.current.revealNext());
    expect(readLiveOptions(t.changes[1]).podiumShown).toBe(0);
    await act(() => t.hook.result.current.postBanner('  Lunch  '));
    expect(t.changes[2]).toMatchObject({ bannerText: 'Lunch', bannerStyle: 0 });
    await act(() => t.hook.result.current.postBanner(null));
    expect(t.changes[3].bannerText).toBeNull();
    const next = setup({ overlay: { ...DEFAULT_OVERLAY, look: { liveOptions: { podiumReveal: 'one', podiumShown: 1 } } } });
    await act(() => next.hook.result.current.revealNext());
    expect(readLiveOptions(next.changes[0]).podiumShown).toBe(2);
  });

  it('moves to the next sponsor and reports a failure', async () => {
    const t = setup();
    await act(() => t.hook.result.current.nextSponsor());
    expect(api.post).toHaveBeenCalledWith('/competitions/1/sponsors/skip');
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    await act(() => t.hook.result.current.nextSponsor());
    expect(t.hook.result.current.error).toBe('Couldn’t move to the next sponsor. Try again.');
  });

  it('ignores a second tap while one is still saving', async () => {
    let release: (value: 'saved') => void = () => {};
    const save = vi.fn(() => new Promise<'saved'>((resolve) => { release = resolve; }));
    const t = setup({ save });
    let first: Promise<void> = Promise.resolve();
    act(() => { first = t.hook.result.current.pick('heat'); });
    await act(() => t.hook.result.current.pick('toplist'));
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => { release('saved'); await first; });
  });
});

describe('saved looks', () => {
  it('applies only visual fields while preserving current race, banner and revision', async () => {
    const t = setup({ overlay: { ...DEFAULT_OVERLAY, revision: 9, bannerText: 'Demo announcement', look: { liveCard: 'heat', liveSectionId: 4 } } });
    await act(() => t.hook.result.current.applyLook({ accent: '#123456', liveSectionId: 999, liveCard: 'podium', logoUrl: 'javascript:alert(1)' }));
    expect(t.changes[0]).toMatchObject({ revision: 9, bannerText: 'Demo announcement', look: { accent: '#123456', liveCard: 'heat', liveSectionId: 4, logoUrl: null } });
  });
  it('reports a revision conflict without claiming the look was applied', async () => {
    const t = setup({ save: vi.fn().mockResolvedValue('conflict') });
    await act(() => t.hook.result.current.applyLook({}));
    expect(t.hook.result.current.conflict).toBe(true);
  });
});
