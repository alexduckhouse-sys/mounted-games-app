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
  { competitionId: 7, owner: true, role: null },
  { competitionId: 8, owner: false, role: 1 },
];
const comp = { id: 5, createdByUserId: 'someone-else' };

beforeEach(() => { serve([]); });

describe('competition access', () => {
  it('loads the list once signed in and describes the role on each competition', async () => {
    signIn();
    serve(access);
    const { result } = mount();
    await waitFor(() => expect(result.current.competitionRole(8)).toBe(1));
    expect(get).toHaveBeenCalledWith('/competitions/access');
    expect(result.current.competitionRole(7)).toBe('owner');
    expect(result.current.competitionRole(9)).toBeNull();
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
    await waitFor(() => expect(result.current.competitionRole(8)).toBe(1));
    act(() => result.current.logout());
    expect(result.current.competitionRole(8)).toBeNull();
    expect(result.current.canOrganise({ id: 8 })).toBe(false);
  });

  it('never shows one person’s list to the next person who signs in', async () => {
    signIn();
    serve(access);
    const { result } = mount();
    await waitFor(() => expect(result.current.competitionRole(8)).toBe(1));
    act(() => result.current.logout());
    serve([]);
    post.mockResolvedValue({ data: stored(['Member'], 'u2') });
    await act(async () => { await result.current.login('bob@example.com', 'pw'); });
    expect(result.current.competitionRole(8)).toBeNull();
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
    expect(result.current.competitionRole(8)).toBeNull();
  });

  it('drops malformed entries but keeps the good ones', async () => {
    signIn();
    serve([
      access[1], null,
      { competitionId: '9', owner: false, role: 1 },
      { competitionId: 10, owner: false, role: 9 },
      { competitionId: 11, owner: 'yes', role: null },
    ]);
    const { result } = mount();
    await waitFor(() => expect(result.current.competitionRole(8)).toBe(1));
    expect(result.current.competitionRole(9)).toBeNull();
    expect(result.current.competitionRole(10)).toBeNull();
    expect(result.current.competitionRole(11)).toBeNull();
  });

  it('keeps the last good list when a refresh fails', async () => {
    signIn();
    serve(access);
    const { result } = mount();
    await waitFor(() => expect(result.current.competitionRole(8)).toBe(1));
    get.mockRejectedValue(new Error('offline'));
    await act(async () => { await result.current.refreshAccess(); });
    expect(result.current.competitionRole(8)).toBe(1);
  });

  it('refreshes on request, picking up a change', async () => {
    signIn();
    serve(access);
    const { result } = mount();
    await waitFor(() => expect(result.current.competitionRole(8)).toBe(1));
    serve([]);
    await act(async () => { await result.current.refreshAccess(); });
    expect(result.current.competitionRole(8)).toBeNull();
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
    expect(result.current.competitionRole(8)).toBeNull();
  });
});

describe('organising and managing one competition', () => {
  it('lets a helper with an ordinary Member account organise and manage only that competition', async () => {
    signIn(['Member']);
    serve([{ competitionId: 5, owner: false, role: 0 }]);
    const { result } = mount();
    expect(result.current.canOrganise(comp)).toBe(false);
    await waitFor(() => expect(result.current.canOrganise(comp)).toBe(true));
    expect(result.current.canManage(comp)).toBe(true);
    expect(result.current.canOrganise({ id: 6, createdByUserId: 'someone-else' })).toBe(false);
    expect(result.current.canManage({ id: 6, createdByUserId: 'someone-else' })).toBe(false);
  });

  it('leaves the no-argument answer alone for a helper', async () => {
    signIn(['Member']);
    serve([{ competitionId: 5, owner: false, role: 0 }]);
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

  it('lets a trainer who helps on someone else’s competition manage it', async () => {
    signIn(['Trainer']);
    serve([{ competitionId: 5, owner: false, role: 1 }]);
    const { result } = mount();
    await waitFor(() => expect(result.current.canManage(comp)).toBe(true));
  });

  it('asks an admin to turn Edit mode on before managing, though they can organise anything', () => {
    signIn(['Admin']);
    const { result } = mount();
    expect(result.current.canOrganise(comp)).toBe(true);
    expect(result.current.canManage(comp)).toBe(false);
    act(() => result.current.setEditorMode(true));
    expect(result.current.canManage(comp)).toBe(true);
    act(() => result.current.setEditorMode(false));
    expect(result.current.canManage(comp)).toBe(false);
  });

  it('holds an admin who is also a helper to Edit mode', async () => {
    signIn(['Admin']);
    serve([{ competitionId: 5, owner: false, role: 0 }]);
    const { result } = mount();
    await waitFor(() => expect(result.current.competitionRole(5)).toBe(0));
    expect(result.current.canManage(comp)).toBe(false);
  });

  it('never lets a signed-out visitor organise or manage', () => {
    const { result } = mount();
    expect(result.current.canOrganise(comp)).toBe(false);
    expect(result.current.canManage(comp)).toBe(false);
    expect(result.current.canManage()).toBe(false);
  });

  it('gives an ordinary member no access to a competition they do not help on', () => {
    signIn(['Member']);
    const { result } = mount();
    expect(result.current.canManage(comp)).toBe(false);
  });
});

describe('managing entries and the shop', () => {
  it.each([
    [0, true], [1, false], [2, false], [3, false], [4, false],
  ])('lets a helper with role %i manage entries: %s', async (role, expected) => {
    signIn(['Member']);
    serve([{ competitionId: 5, owner: false, role }]);
    const { result } = mount();
    await waitFor(() => expect(result.current.canOrganise(comp)).toBe(true));
    expect(result.current.canManageEntries(comp)).toBe(expected);
  });

  it('never extends a co-organiser’s entry access to another competition', async () => {
    signIn(['Member']);
    serve([{ competitionId: 5, owner: false, role: 0 }]);
    const { result } = mount();
    await waitFor(() => expect(result.current.canOrganise(comp)).toBe(true));
    expect(result.current.canManageEntries({ id: 6, createdByUserId: 'someone-else' })).toBe(false);
  });

  it('lets the owner in, from the competition or from the access list', async () => {
    signIn(['Trainer']);
    serve([{ competitionId: 9, owner: true, role: null }]);
    const { result } = mount();
    expect(result.current.canManageEntries({ id: 5, createdByUserId: 'u1' })).toBe(true);
    expect(result.current.canManageEntries({ id: 5, createdByUserId: 'u2' })).toBe(false);
    await waitFor(() => expect(result.current.canManageEntries({ id: 9, createdByUserId: 'u2' })).toBe(true));
  });

  it('lets an admin in whether or not Edit mode is on, and a trainer with no competition in question', () => {
    signIn(['Admin']);
    expect(mount().result.current.canManageEntries(comp)).toBe(true);
    signIn(['Trainer']);
    expect(mount().result.current.canManageEntries()).toBe(true);
  });

  it('keeps out ordinary members, other accounts and signed-out visitors', () => {
    signIn(['Member']);
    expect(mount().result.current.canManageEntries(comp)).toBe(false);
    expect(mount().result.current.canManageEntries()).toBe(false);
    localStorage.clear();
    expect(mount().result.current.canManageEntries(comp)).toBe(false);
  });
});
