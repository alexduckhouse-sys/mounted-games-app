import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type StoredAuth } from '../api';
import { AuthProvider, useAuth } from './AuthContext';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn(), post: vi.fn() },
}));
const get = vi.mocked(api.get);
const post = vi.mocked(api.post);

const stored = (roles: string[] = ['Member'], id = 'u1'): StoredAuth => ({
  token: 'tok-1',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  user: { id, email: 'ann@example.com', fullName: 'Ann Smith', clubId: 4, clubName: 'Ashdown', roles },
});
const signIn = (roles?: string[]) => localStorage.setItem('mg.auth', JSON.stringify(stored(roles)));
const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;
const mount = () => renderHook(() => useAuth(), { wrapper });

/** Answers `/competitions/access` with `list` and every other call (the /auth/me check) with a profile. */
function serve(list: unknown) {
  get.mockImplementation((url: string) => (
    url === '/competitions/access' ? Promise.resolve({ data: list }) : Promise.resolve({ data: stored().user })));
}

const access = [
  { competitionId: 7, owner: true },
  { competitionId: 8, owner: false },
];
const comp = { id: 5, createdByUserId: 'someone-else' };

beforeEach(() => { serve([]); });

describe('competition access', () => {
  it('loads the list once signed in and knows which competitions they run', async () => {
    signIn();
    serve(access);
    const { result } = mount();
    await waitFor(() => expect(result.current.canOrganise({ id: 8 })).toBe(true));
    expect(get).toHaveBeenCalledWith('/competitions/access');
    expect(result.current.canOrganise({ id: 7 })).toBe(true);
    expect(result.current.canOrganise({ id: 9 })).toBe(false);
  });

  it('does not ask while signed out', () => {
    mount();
    expect(get).not.toHaveBeenCalled();
  });

  it('asks again after signing in, and forgets everything on sign-out', async () => {
    serve(access);
    post.mockResolvedValue({ data: stored() });
    const { result } = mount();
    await act(async () => { await result.current.login('ann@example.com', 'pw'); });
    await waitFor(() => expect(result.current.canOrganise({ id: 8 })).toBe(true));
    act(() => result.current.logout());
    expect(result.current.canOrganise({ id: 8 })).toBe(false);
    expect(result.current.canOrganise({ id: 8 })).toBe(false);
  });

  it('never shows one person’s list to the next person who signs in', async () => {
    signIn();
    serve(access);
    const { result } = mount();
    await waitFor(() => expect(result.current.canOrganise({ id: 8 })).toBe(true));
    act(() => result.current.logout());
    serve([]);
    post.mockResolvedValue({ data: stored(['Member'], 'u2') });
    await act(async () => { await result.current.login('bob@example.com', 'pw'); });
    expect(result.current.canOrganise({ id: 8 })).toBe(false);
  });

  it.each([
    ['an object', { competitionId: 8 }],
    ['nothing', null],
  ])('ignores an answer that is %s and keeps no access', async (_name, bad) => {
    signIn();
    serve(bad);
    const { result } = mount();
    await waitFor(() => expect(get).toHaveBeenCalledWith('/competitions/access'));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.canOrganise({ id: 8 })).toBe(false);
  });

  it('drops malformed entries but keeps the good ones', async () => {
    signIn();
    serve([
      access[1], null,
      { competitionId: '9', owner: false },
      { competitionId: 10, owner: null },
      { competitionId: 11, owner: 'yes' },
    ]);
    const { result } = mount();
    await waitFor(() => expect(result.current.canOrganise({ id: 8 })).toBe(true));
    expect(result.current.canOrganise({ id: 9 })).toBe(false);
    expect(result.current.canOrganise({ id: 10 })).toBe(false);
    expect(result.current.canOrganise({ id: 11 })).toBe(false);
  });

  it('keeps the last good list when a refresh fails', async () => {
    signIn();
    serve(access);
    const { result } = mount();
    await waitFor(() => expect(result.current.canOrganise({ id: 8 })).toBe(true));
    get.mockRejectedValue(new Error('offline'));
    await act(async () => { await result.current.refreshAccess(); });
    expect(result.current.canOrganise({ id: 8 })).toBe(true);
  });

  it('refreshes on request, picking up a change', async () => {
    signIn();
    serve(access);
    const { result } = mount();
    await waitFor(() => expect(result.current.canOrganise({ id: 8 })).toBe(true));
    serve([]);
    await act(async () => { await result.current.refreshAccess(); });
    expect(result.current.canOrganise({ id: 8 })).toBe(false);
  });

  it('has nothing to refresh while signed out', async () => {
    const { result } = mount();
    await act(async () => { await result.current.refreshAccess(); });
    expect(get).not.toHaveBeenCalled();
  });

  it('ignores a list that arrives after the page has gone', async () => {
    signIn();
    let finish!: (value: { data: unknown }) => void;
    get.mockImplementation((url: string) => (url === '/competitions/access'
      ? new Promise((resolve) => { finish = resolve as typeof finish; })
      : Promise.resolve({ data: stored().user })));
    const { result, unmount } = mount();
    await waitFor(() => expect(get).toHaveBeenCalledWith('/competitions/access'));
    unmount();
    await act(async () => { finish({ data: access }); });
    expect(result.current.canOrganise({ id: 8 })).toBe(false);
  });
});

describe('organising and managing one competition', () => {
  it('lets a competition admin with an ordinary Member account organise and manage only that competition', async () => {
    signIn(['Member']);
    serve([{ competitionId: 5, owner: false }]);
    const { result } = mount();
    expect(result.current.canOrganise(comp)).toBe(false);
    await waitFor(() => expect(result.current.canOrganise(comp)).toBe(true));
    expect(result.current.canManage(comp)).toBe(true);
    expect(result.current.canOrganise({ id: 6, createdByUserId: 'someone-else' })).toBe(false);
    expect(result.current.canManage({ id: 6, createdByUserId: 'someone-else' })).toBe(false);
  });

  it('leaves the no-argument answer alone for a competition admin', async () => {
    signIn(['Member']);
    serve([{ competitionId: 5, owner: false }]);
    const { result } = mount();
    await waitFor(() => expect(result.current.canOrganise(comp)).toBe(true));
    expect(result.current.canOrganise()).toBe(false);
  });

  it('lets the trainer who owns it manage it, and no other trainer', () => {
    signIn(['Trainer']);
    const { result } = mount();
    expect(result.current.canManage({ id: 5, createdByUserId: 'u1' })).toBe(true);
    expect(result.current.canManage({ id: 5, createdByUserId: 'u2' })).toBe(false);
    expect(result.current.canManage()).toBe(true);
  });

  it('lets a trainer who is a competition admin on someone else’s competition manage it', async () => {
    signIn(['Trainer']);
    serve([{ competitionId: 5, owner: false }]);
    const { result } = mount();
    await waitFor(() => expect(result.current.canManage(comp)).toBe(true));
  });

  it('lets an admin manage any competition without a switch', () => {
    signIn(['Admin']);
    const { result } = mount();
    expect(result.current.canOrganise(comp)).toBe(true);
    expect(result.current.canManage(comp)).toBe(true);
  });

  it('still lets an admin manage when they are also on the competition team', async () => {
    signIn(['Admin']);
    serve([{ competitionId: 5, owner: false }]);
    const { result } = mount();
    await waitFor(() => expect(get).toHaveBeenCalledWith('/competitions/access'));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.canManage(comp)).toBe(true);
  });

  it('never lets a signed-out visitor organise or manage', () => {
    const { result } = mount();
    expect(result.current.canOrganise(comp)).toBe(false);
    expect(result.current.canManage(comp)).toBe(false);
    expect(result.current.canManage()).toBe(false);
  });

  it('gives an ordinary member no access to a competition they are not on the team of', () => {
    signIn(['Member']);
    const { result } = mount();
    expect(result.current.canManage(comp)).toBe(false);
  });
});
