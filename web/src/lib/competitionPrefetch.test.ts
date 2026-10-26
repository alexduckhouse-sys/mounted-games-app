import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { readSavedCopy, savedCopyKeys } from '../offline/savedCopies';
import { competition } from '../test/factories';
import { createCompetitionPrefetcher, prefetchCompetition } from './competitionPrefetch';

vi.mock('../api', () => ({
  api: {
    get: vi.fn(),
  },
}));

describe('prefetchCompetition and createCompetitionPrefetcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('fetches GET /competitions/:id and saves fresh CompetitionDetail to savedCopies', async () => {
    const detail = competition({ id: 42, name: 'Summer Nationals' });
    vi.mocked(api.get).mockResolvedValueOnce({ data: detail, headers: {} } as never);

    await prefetchCompetition(42);

    expect(api.get).toHaveBeenCalledWith('/competitions/42');
    expect(readSavedCopy(savedCopyKeys.competition(42))?.data).toMatchObject({
      id: 42,
      name: 'Summer Nationals',
    });
  });

  it('does not overwrite savedCopies when response comes from service worker offline fallback or fails', async () => {
    const detail = competition({ id: 55, name: 'Stale Event' });
    vi.mocked(api.get).mockResolvedValueOnce({
      data: detail,
      headers: { 'x-mg-saved-copy': '1' },
    } as never);

    await prefetchCompetition(55);
    expect(readSavedCopy(savedCopyKeys.competition(55))).toBeNull();

    vi.mocked(api.get).mockRejectedValueOnce(new Error('network down'));
    await expect(prefetchCompetition(55)).resolves.toBeUndefined();
  });

  it('deduplicates warm calls per competition ID', () => {
    const spy = vi.fn();
    const prefetcher = createCompetitionPrefetcher(spy);

    expect(prefetcher.hasWarmed(7)).toBe(false);
    prefetcher.warm(7);
    prefetcher.warm(7);
    prefetcher.warm(8);

    expect(prefetcher.hasWarmed(7)).toBe(true);
    expect(prefetcher.hasWarmed(8)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, 7);
    expect(spy).toHaveBeenNthCalledWith(2, 8);
  });
});
