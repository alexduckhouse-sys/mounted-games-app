import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { axiosError, heat } from '../test/factories';
import type { QueuedScore } from './scoreOutbox';
import { flushOutbox, HEAT_SAVED, readOutbox, updateOutbox, useScoreOutbox } from './useScoreOutbox';

vi.mock('../api', () => ({ api: { post: vi.fn() } }));
const post = vi.mocked(api.post);

const KEY = 'mg.outbox.scores';
const queued = (raceId: number, extra: Partial<QueuedScore> = {}): QueuedScore => ({
  raceId, competitionId: 1, sessionId: 7, label: `Race ${raceId}`,
  places: [{ teamId: 1, place: 1, eliminated: false }], expected: [], teamNames: { 1: 'Red Rum' },
  queuedAt: `2026-06-01T10:0${raceId}:00Z`, state: 'waiting', ...extra,
});
const seed = (...items: QueuedScore[]) => localStorage.setItem(KEY, JSON.stringify(items));
const outbox = () => JSON.parse(localStorage.getItem(KEY) ?? '[]') as QueuedScore[];
const saved = (data = heat(5)) => ({ data });
const online = (value: boolean) => vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value);

beforeEach(() => { online(true); });

describe('readOutbox', () => {
  it('is empty when nothing is stored', () => {
    expect(readOutbox()).toEqual([]);
  });

  it('returns what is stored', () => {
    seed(queued(1));
    expect(readOutbox()).toEqual([queued(1)]);
  });

  it('is empty when the stored value is corrupt or not a list', () => {
    localStorage.setItem(KEY, '{broken');
    expect(readOutbox()).toEqual([]);
    localStorage.setItem(KEY, '{"a":1}');
    expect(readOutbox()).toEqual([]);
  });
});

describe('flushOutbox', () => {
  it('sends waiting results oldest first, posting what the scorer saw, and clears them', async () => {
    seed(queued(1, { expected: [{ teamId: 1, place: 2, eliminated: false }] }), queued(2));
    post.mockResolvedValue(saved());
    await flushOutbox();
    expect(post.mock.calls.map(([url]) => url)).toEqual(['/races/1/results', '/races/2/results']);
    expect(post).toHaveBeenNthCalledWith(1, '/races/1/results',
      { places: queued(1).places, expected: [{ teamId: 1, place: 2, eliminated: false }] }, { timeout: 15_000 });
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('tells open pages about the heat the server returned', async () => {
    seed(queued(1));
    const returned = heat(5, { label: 'Updated' });
    post.mockResolvedValue(saved(returned));
    const listener = vi.fn();
    window.addEventListener(HEAT_SAVED, listener);
    await flushOutbox();
    window.removeEventListener(HEAT_SAVED, listener);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ sessionId: 7, heat: returned });
  });

  it('keeps a result and stops when the phone has no signal', async () => {
    seed(queued(1), queued(2));
    post.mockRejectedValue(axiosError(undefined, 'ERR_NETWORK'));
    await flushOutbox();
    expect(post).toHaveBeenCalledTimes(1);
    expect(outbox().map((q) => q.state)).toEqual(['waiting', 'waiting']);
  });

  it('marks a conflict with the server’s results and tells open pages', async () => {
    seed(queued(1));
    const theirHeat = heat(5);
    post.mockRejectedValue(axiosError({ status: 409, data: { sessionId: 7, heat: theirHeat } }));
    const listener = vi.fn();
    window.addEventListener(HEAT_SAVED, listener);
    await flushOutbox();
    window.removeEventListener(HEAT_SAVED, listener);
    expect(outbox()[0]).toMatchObject({ raceId: 1, state: 'conflict', theirs: [] });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('marks a rejected result as failed and carries on with the next one', async () => {
    seed(queued(1), queued(2));
    post.mockRejectedValueOnce(axiosError({ status: 404 })).mockResolvedValueOnce(saved());
    await flushOutbox();
    expect(outbox()).toHaveLength(1);
    expect(outbox()[0]).toMatchObject({ raceId: 1, state: 'failed', error: 'This race no longer exists.' });
  });

  it('sends nothing while offline', async () => {
    online(false);
    seed(queued(1));
    await flushOutbox();
    expect(post).not.toHaveBeenCalled();
  });

  it('sends nothing when there is nothing waiting', async () => {
    seed(queued(1, { state: 'failed' }));
    await flushOutbox();
    expect(post).not.toHaveBeenCalled();
  });

  it('shares one flush between simultaneous callers', async () => {
    seed(queued(1));
    post.mockResolvedValue(saved());
    await Promise.all([flushOutbox(), flushOutbox()]);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('can flush again once the previous flush has finished', async () => {
    seed(queued(1));
    post.mockResolvedValue(saved());
    await flushOutbox();
    seed(queued(2));
    await flushOutbox();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('sends each save at most once per flush even when storage cannot record the result', async () => {
    seed(queued(1));
    post.mockResolvedValue(saved());
    const realSetItem = Storage.prototype.setItem;
    const realRemoveItem = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function removeItem(this: Storage, key: string) {
      if (key === KEY) throw new Error('blocked');
      realRemoveItem.call(this, key);
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(this: Storage, key: string, value: string) {
      if (key === KEY) throw new Error('blocked');
      realSetItem.call(this, key, value);
    });
    await flushOutbox();
    expect(post).toHaveBeenCalledTimes(1);
    expect(outbox()).toHaveLength(1);
  });
});

describe('updateOutbox', () => {
  it('stores the changed list and tells listeners', () => {
    const listener = vi.fn();
    window.addEventListener('mg:outbox', listener);
    updateOutbox(() => [queued(1, { state: 'failed' })]);
    window.removeEventListener('mg:outbox', listener);
    expect(outbox()).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('removes the stored list once it is empty', () => {
    seed(queued(1, { state: 'failed' }));
    updateOutbox(() => []);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('starts sending straight away when something is waiting', async () => {
    post.mockResolvedValue(saved());
    updateOutbox((list) => [...list, queued(1)]);
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(localStorage.getItem(KEY)).toBeNull());
  });

  it('does not try to send when nothing is waiting', () => {
    updateOutbox(() => [queued(1, { state: 'conflict' })]);
    expect(post).not.toHaveBeenCalled();
  });

  it('still updates listeners when storage is full', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    const listener = vi.fn();
    window.addEventListener('mg:outbox', listener);
    expect(() => updateOutbox(() => [queued(1, { state: 'failed' })])).not.toThrow();
    window.removeEventListener('mg:outbox', listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('useScoreOutbox', () => {
  it('starts with what is stored', () => {
    seed(queued(1));
    const { result } = renderHook(() => useScoreOutbox());
    expect(result.current.map((q) => q.raceId)).toEqual([1]);
  });

  it('follows changes made anywhere in the app', () => {
    const { result } = renderHook(() => useScoreOutbox());
    expect(result.current).toEqual([]);
    act(() => updateOutbox(() => [queued(2, { state: 'failed' })]));
    expect(result.current.map((q) => q.raceId)).toEqual([2]);
  });

  it('follows changes made in another tab, but only to the outbox', () => {
    const { result } = renderHook(() => useScoreOutbox());
    act(() => {
      seed(queued(3, { state: 'failed' }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'something.else' }));
    });
    expect(result.current).toEqual([]);
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: KEY })); });
    expect(result.current.map((q) => q.raceId)).toEqual([3]);
  });

  it('stops listening when unmounted', () => {
    const { result, unmount } = renderHook(() => useScoreOutbox());
    unmount();
    seed(queued(4, { state: 'failed' }));
    window.dispatchEvent(new CustomEvent('mg:outbox'));
    expect(result.current).toEqual([]);
  });
});
