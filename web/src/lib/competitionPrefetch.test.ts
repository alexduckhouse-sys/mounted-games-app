import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { readSavedCopy, savedCopyKeys } from '../offline/savedCopies';
import { competition } from '../test/factories';
import { createCompetitionPrefetcher, prefetchCompetition, pendingCompetitionPrefetch } from './competitionPrefetch';

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

it('lets a navigation and repeated hover share one pending response, then allows a fresh fetch', async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(api.get).mockImplementationOnce(() => new Promise((done) => { resolve = done; }) as never);
  const warm = prefetchCompetition(99);
  const navigation = pendingCompetitionPrefetch(99);
  const hover = prefetchCompetition(99);
  expect(navigation).toBeDefined();
  expect(api.get).toHaveBeenCalledTimes(1);
  const value = { data: competition({ id: 99 }), headers: {} };
  resolve(value);
  await expect(navigation).resolves.toBe(value);
  await Promise.all([warm, hover]);
  expect(pendingCompetitionPrefetch(99)).toBeUndefined();
});

it('does not share or save a response after the sign-in changes', async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(api.get).mockImplementationOnce(() => new Promise((done) => { resolve = done; }) as never);
  const warm = prefetchCompetition(100);
  const oldNavigation = pendingCompetitionPrefetch(100);
  localStorage.setItem('mg.auth', 'different-account');
  expect(pendingCompetitionPrefetch(100)).toBeUndefined();
  resolve({ data: competition({ id: 100 }), headers: {} });
  await expect(oldNavigation).rejects.toThrow('Sign-in changed');
  await warm;
  expect(readSavedCopy(savedCopyKeys.competition(100))).toBeNull();
});


it('clears a rejected fill so a later hover can retry', async () => {
  vi.mocked(api.get).mockRejectedValueOnce(new Error('fake offline')).mockResolvedValueOnce({ data: competition({ id: 101 }), headers: {} });
  await prefetchCompetition(101);
  expect(pendingCompetitionPrefetch(101)).toBeUndefined();
  await prefetchCompetition(101);
  expect(readSavedCopy(savedCopyKeys.competition(101))).not.toBeNull();
  expect(api.get).toHaveBeenCalledTimes(2);
});

it('does not remove a replacement request when the old account request finishes', async () => {
  let oldFinish!: (value: unknown) => void;
  let newFinish!: (value: unknown) => void;
  vi.mocked(api.get)
    .mockImplementationOnce(() => new Promise((resolve) => { oldFinish = resolve; }) as never)
    .mockImplementationOnce(() => new Promise((resolve) => { newFinish = resolve; }) as never);
  const oldWarm = prefetchCompetition(102);
  localStorage.setItem('mg.auth', 'fake-other-account');
  const newWarm = prefetchCompetition(102);
  const replacement = pendingCompetitionPrefetch(102);
  oldFinish({ data: competition({ id: 102, name: 'Fake old event' }), headers: {} });
  await oldWarm;
  expect(pendingCompetitionPrefetch(102)).toBe(replacement);
  newFinish({ data: competition({ id: 102, name: 'Fake new event' }), headers: {} });
  await newWarm;
  expect(readSavedCopy(savedCopyKeys.competition(102))?.data).toMatchObject({ name: 'Fake new event' });
});
