import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as buffer from '../live/replayBuffer';
import type { SavedReplayClip } from '../live/replayBuffer';
import { useSavedReplays } from './useSavedReplays';

vi.mock('../live/replayBuffer');
const clip = (id: string): SavedReplayClip => ({ id, competitionId: 1, arenaName: 'A', label: id, createdAt: '', durationSeconds: 5, mimeType: 'video/webm', blob: new Blob(), url: 'blob:x' });

describe('useSavedReplays', () => {
  let listener: () => void = () => {};
  let saved: SavedReplayClip[] = [];
  beforeEach(() => {
    saved = [clip('a')];
    vi.mocked(buffer.getSavedReplays).mockImplementation(() => saved);
    vi.mocked(buffer.subscribeSavedReplays).mockImplementation((next) => { listener = next; return vi.fn(); });
    vi.mocked(buffer.hydrateSavedReplays).mockResolvedValue([]);
  });

  it('starts with the clips on this device, loads the stored ones and follows changes', async () => {
    const { result } = renderHook(() => useSavedReplays(1));
    expect(result.current.map((c) => c.id)).toEqual(['a']);
    await act(async () => {});
    expect(buffer.hydrateSavedReplays).toHaveBeenCalledWith(1);
    saved = [clip('a'), clip('b')];
    act(() => listener());
    expect(result.current.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('copes with stored clips failing to load, and stops listening when it goes', async () => {
    vi.mocked(buffer.hydrateSavedReplays).mockRejectedValue(new Error('no storage'));
    const unsubscribe = vi.fn();
    vi.mocked(buffer.subscribeSavedReplays).mockReturnValue(unsubscribe);
    const { unmount } = renderHook(() => useSavedReplays(1));
    await act(async () => {});
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
