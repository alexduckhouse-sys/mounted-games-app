import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as buffer from '../live/replayBuffer';
import type { SavedReplayClip } from '../live/replayBuffer';
import type { QueuedScoreCard } from '../lib/scoreCard';
import { RACE_RECORDING_SECONDS, useControllerReplay } from './useControllerReplay';

vi.mock('../live/replayBuffer');

const clip = (id: string): SavedReplayClip => ({ id, competitionId: 1, arenaName: 'Main', label: id, createdAt: '', durationSeconds: 5, mimeType: 'video/webm', blob: new Blob(), url: 'blob:x' });
const card = (key: string, arenaName = 'Main'): QueuedScoreCard => ({ key, arenaName, heading: 'Seniors · Heat 1', card: { raceName: `Race ${key}` } as never, receivedAt: 0 });
const media = {} as MediaStream;

let handle: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; saveClip: ReturnType<typeof vi.fn> };
let onStatus: (status: buffer.ReplayBufferStatus) => void = () => {};

beforeEach(() => {
  handle = { start: vi.fn(() => true), stop: vi.fn(), dispose: vi.fn(), saveClip: vi.fn(async (label?: string) => clip(label ?? 'x')) };
  vi.mocked(buffer.createReplayBuffer).mockImplementation((options) => { onStatus = options.onStatus!; return handle as never; });
  vi.mocked(buffer.tagSavedReplay).mockReset();
  vi.mocked(buffer.removeSavedReplay).mockReset();
});

const setup = (props: Partial<Parameters<typeof useControllerReplay>[0]> = {}) =>
  renderHook((p: Parameters<typeof useControllerReplay>[0]) => useControllerReplay(p), {
    initialProps: { competitionId: 1, arena: 'Main', streamId: 4, media: media as MediaStream | null, scoreCards: [] as QueuedScoreCard[], ...props },
  });

describe('useControllerReplay', () => {
  it('records the video it is given and stops when the video goes', () => {
    const { result, rerender, unmount } = setup();
    expect(buffer.createReplayBuffer).toHaveBeenCalledWith(expect.objectContaining({ competitionId: 1, streamId: 4, arenaName: 'Main', windowSeconds: 1800 }));
    expect(handle.start).toHaveBeenCalledWith(media);
    expect(result.current.recording).toBe(true);
    act(() => onStatus({ retainedSeconds: 42, warning: 'Low space' }));
    expect(result.current.retainedSeconds).toBe(42);
    expect(result.current.warning).toBe('Low space');
    rerender({ competitionId: 1, arena: 'Main', streamId: 4, media: null, scoreCards: [] });
    // A gap in the video (a camera switch) pauses recording but keeps the 30 minutes already recorded.
    expect(handle.stop).toHaveBeenCalled();
    expect(handle.dispose).not.toHaveBeenCalled();
    expect(result.current.recording).toBe(false);
    expect(result.current.retainedSeconds).toBe(0);
    const next = {} as MediaStream;
    rerender({ competitionId: 1, arena: 'Main', streamId: 5, media: next, scoreCards: [] });
    expect(handle.start).toHaveBeenLastCalledWith(next);
    expect(buffer.createReplayBuffer).toHaveBeenCalledTimes(1);
    unmount();
    expect(handle.dispose).toHaveBeenCalled();
  });

  it('names the arena Arena when it has none, and works without a stream id', () => {
    setup({ arena: '', streamId: null });
    expect(buffer.createReplayBuffer).toHaveBeenCalledWith(expect.objectContaining({ arenaName: 'Arena', streamId: undefined }));
  });

  it('saves an instant replay, tags it and remembers it as just made', async () => {
    const { result } = setup();
    const done = vi.fn();
    act(() => result.current.instant(30, 'Race 3 finish', done));
    await act(async () => {});
    expect(handle.saveClip).toHaveBeenCalledWith('Race 3 finish', expect.objectContaining({ durationSeconds: 30 }));
    expect(buffer.tagSavedReplay).toHaveBeenCalledWith('Race 3 finish', 'instant');
    expect(result.current.justMadeId).toBe('Race 3 finish');
    expect(done).toHaveBeenCalledWith(expect.objectContaining({ id: 'Race 3 finish' }));
  });

  it('works without a done callback', async () => {
    const { result } = setup();
    act(() => result.current.instant(15, 'Quick'));
    await act(async () => {});
    expect(result.current.justMadeId).toBe('Quick');
  });

  it('discards a just-made clip', async () => {
    const { result } = setup();
    act(() => result.current.instant(30, 'Oops'));
    await act(async () => {});
    act(() => result.current.cancelClip('Oops'));
    expect(buffer.removeSavedReplay).toHaveBeenCalledWith('Oops');
    expect(result.current.justMadeId).toBeNull();
    act(() => result.current.instant(30, 'Next'));
    await act(async () => {});
    act(() => result.current.cancelClip('something else'));
    expect(result.current.justMadeId).toBe('Next');
  });

  it('says so when there is no video to record from', () => {
    const { result } = setup({ media: null });
    act(() => result.current.instant(30, 'x'));
    expect(result.current.error).toContain('Replays are recorded from the video on this page');
    expect(handle.saveClip).not.toHaveBeenCalled();
  });

  it('shows the reason a clip could not be prepared', async () => {
    handle.saveClip.mockRejectedValueOnce(new Error('Keep this tab open'));
    const { result } = setup();
    act(() => result.current.instant(30, 'x'));
    await act(async () => {});
    expect(result.current.error).toBe('Keep this tab open');
    expect(result.current.progress).toBeNull();
    result.current.cancelPreparation();
  });

  it('keeps a recording of each race scored after the page opened, but not the ones already there', async () => {
    const { rerender } = setup({ scoreCards: [card('old')] });
    await act(async () => {});
    expect(handle.saveClip).not.toHaveBeenCalled();
    rerender({ competitionId: 1, arena: 'Main', streamId: 4, media, scoreCards: [card('old'), card('r2')] });
    await act(async () => {});
    expect(handle.saveClip).toHaveBeenCalledWith('Seniors · Heat 1 · Race r2', expect.objectContaining({ durationSeconds: RACE_RECORDING_SECONDS }));
    expect(buffer.tagSavedReplay).toHaveBeenCalledWith('Seniors · Heat 1 · Race r2', 'race');
    rerender({ competitionId: 1, arena: 'Main', streamId: 4, media, scoreCards: [card('old'), card('r2')] });
    await act(async () => {});
    expect(handle.saveClip).toHaveBeenCalledTimes(1);
  });

  it('records a race with no arena, and skips other arenas, an empty list and a missing video', async () => {
    const { rerender } = setup({ scoreCards: undefined });
    rerender({ competitionId: 1, arena: 'Main', streamId: 4, media, scoreCards: [card('a', '')] });
    await act(async () => {});
    expect(handle.saveClip).toHaveBeenCalledTimes(1);
    rerender({ competitionId: 1, arena: 'Main', streamId: 4, media, scoreCards: [card('a', ''), card('b', 'Second arena')] });
    await act(async () => {});
    expect(handle.saveClip).toHaveBeenCalledTimes(1);
    rerender({ competitionId: 1, arena: 'Main', streamId: 4, media, scoreCards: [] });
    rerender({ competitionId: 1, arena: 'Main', streamId: 4, media: null, scoreCards: [card('c')] });
    await act(async () => {});
    expect(handle.saveClip).toHaveBeenCalledTimes(1);
  });
});
