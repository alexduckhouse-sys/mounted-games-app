import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { competition, team } from '../test/factories';
import { useMyTeams } from './useMyTeams';

vi.mock('../api', () => ({ api: { get: vi.fn() } }));
const auth = vi.hoisted(() => ({ user: { id: 'u1' } as { id: string } | null }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }));
const get = vi.mocked(api.get);

const form = { id: 1, teamId: 1 };
let teams = [team(1, { competitionId: 5 }), team(2, { competitionId: 5 }), team(3, { competitionId: 6 })];
let forms: unknown[] = [form];

beforeEach(() => {
  auth.user = { id: 'u1' };
  teams = [team(1, { competitionId: 5 }), team(2, { competitionId: 5 }), team(3, { competitionId: 6 })];
  forms = [form];
  get.mockImplementation(async (url) => {
    if (url === '/trainer/my-teams') return { data: teams } as never;
    if (url === '/declaration-forms') return { data: forms } as never;
    return { data: competition({ id: Number(url.split('/').pop()) }) } as never;
  });
});

describe('useMyTeams', () => {
  it('loads the teams, their forms and each competition once', async () => {
    const { result } = renderHook(() => useMyTeams());
    expect(result.current.loaded).toBe(false);
    await waitFor(() => expect(result.current.comps.size).toBe(2));
    expect(result.current.loaded).toBe(true);
    expect(result.current.teams.map((t) => t.id)).toEqual([1, 2, 3]);
    expect(result.current.forms).toEqual([form]);
    expect([...result.current.comps.keys()].sort()).toEqual([5, 6]);
    expect(get.mock.calls.filter(([url]) => url === '/competitions/5')).toHaveLength(1);
  });

  it('fetches nothing for a visitor', () => {
    auth.user = null;
    const { result } = renderHook(() => useMyTeams());
    expect(result.current.loaded).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });

  it('keeps going when the forms or a competition will not load', async () => {
    get.mockImplementation(async (url) => {
      if (url === '/trainer/my-teams') return { data: teams } as never;
      if (url === '/competitions/6') throw new Error('offline');
      if (url === '/declaration-forms') throw new Error('offline');
      return { data: competition({ id: 5 }) } as never;
    });
    const { result } = renderHook(() => useMyTeams());
    await waitFor(() => expect(result.current.comps.size).toBe(1));
    expect(result.current.teams).toHaveLength(3);
    expect(result.current.forms).toEqual([]);
  });

  it('ignores answers that are not lists', async () => {
    get.mockImplementation(async (url) => (url === '/trainer/my-teams' || url === '/declaration-forms' ? { data: '<html>' } : { data: competition() }) as never);
    const { result } = renderHook(() => useMyTeams());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.teams).toEqual([]);
    expect(result.current.forms).toEqual([]);
  });

  it('reloads on request, keeping the old teams if the reload fails, without refetching competitions', async () => {
    const { result } = renderHook(() => useMyTeams());
    await waitFor(() => expect(result.current.comps.size).toBe(2));
    teams = [team(1, { competitionId: 5 })];
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.teams).toHaveLength(1));
    expect(get.mock.calls.filter(([url]) => url === '/competitions/6')).toHaveLength(1);
    get.mockImplementation(async () => { throw new Error('offline'); });
    act(() => result.current.reload());
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(6));
    expect(result.current.teams).toHaveLength(1);
  });

  it('never shows one person’s teams to the next', async () => {
    const { result, rerender } = renderHook(() => useMyTeams());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    auth.user = { id: 'u2' };
    rerender();
    expect(result.current.loaded).toBe(false);
    expect(result.current.teams).toEqual([]);
    await waitFor(() => expect(result.current.loaded).toBe(true));
  });

  it('does not set state after it is unmounted', async () => {
    const { unmount } = renderHook(() => useMyTeams());
    unmount();
    await Promise.resolve();
    expect(get).toHaveBeenCalled();
  });
});
