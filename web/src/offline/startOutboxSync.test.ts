import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { heat } from '../test/factories';
import type { QueuedScore } from './scoreOutbox';
import { startOutboxSync } from './useScoreOutbox';

// startOutboxSync never unregisters its listeners, so it gets a file of its own and is started once.
vi.mock('../api', () => ({ api: { post: vi.fn() } }));
const post = vi.mocked(api.post);

const waiting = (raceId: number): QueuedScore => ({
  raceId, competitionId: 1, sessionId: 1, label: 'Race', places: [], expected: [], teamNames: {},
  queuedAt: `2026-06-01T10:0${raceId}:00Z`, state: 'waiting',
});
const seed = (raceId: number) => localStorage.setItem('mg.outbox.scores', JSON.stringify([waiting(raceId)]));
const visibility = (state: DocumentVisibilityState) => vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);

beforeAll(() => {
  vi.useFakeTimers();
  seed(1);
  post.mockResolvedValue({ data: heat(1) });
  startOutboxSync();
});
afterAll(() => { vi.useRealTimers(); });
beforeEach(() => { post.mockClear(); post.mockResolvedValue({ data: heat(1) }); });

describe('startOutboxSync', () => {
  it('tries to send straight away when started', () => {
    // The call from beforeAll was cleared; verify via the result: the waiting result was sent.
    expect(localStorage.getItem('mg.outbox.scores')).toBeNull();
  });

  it('retries when the phone comes back online', async () => {
    seed(2);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('retries when the page becomes visible again, but not while hidden', async () => {
    seed(3);
    visibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(post).not.toHaveBeenCalled();
    visibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('retries every 20 seconds', async () => {
    seed(4);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(post).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(post).toHaveBeenCalledTimes(1);
  });
});
