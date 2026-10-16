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

const stored = (roles: string[] = ['Trainer'], extra: Partial<StoredAuth['user']> = {}): StoredAuth => ({
  token: 'tok-1',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  user: { id: 'u1', email: 'ann@example.com', fullName: 'Ann Smith', clubId: 4, clubName: 'Ashdown', roles, ...extra },
});
const signIn = (roles?: string[]) => localStorage.setItem('mg.auth', JSON.stringify(stored(roles)));
const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;
const mount = () => renderHook(() => useAuth(), { wrapper });
const unauthorised = { response: { status: 401 } };

beforeEach(() => { get.mockResolvedValue({ data: {} }); });

describe('useAuth', () => {
  it('must be used inside the provider', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useAuth())).toThrow('useAuth must be used within AuthProvider');
    error.mockRestore();
  });

  it('starts signed out', () => {
    const { result } = mount();
    expect(result.current).toMatchObject({ user: null, token: null, loading: false, editorMode: false });
    expect(get).not.toHaveBeenCalled();
  });

  it('restores a saved login and checks it with the server', async () => {
    signIn();
    const { result } = mount();
    expect(result.current.user).toEqual({ id: 'u1', email: 'ann@example.com', fullName: 'Ann Smith', clubId: 4, clubName: 'Ashdown', roles: ['Trainer'] });
    expect(result.current.token).toBe('tok-1');
    await waitFor(() => expect(get).toHaveBeenCalledWith('/auth/me'));
  });

  it('signs out when the server says the saved login is no longer valid', async () => {
    signIn();
    get.mockRejectedValue(unauthorised);
    const { result } = mount();
    await waitFor(() => expect(result.current.user).toBeNull());
    expect(localStorage.getItem('mg.auth')).toBeNull();
  });

  it('keeps the saved login when the check fails for any other reason', async () => {
    signIn();
    get.mockRejectedValue({ response: { status: 500 } });
    const { result } = mount();
    await waitFor(() => expect(get).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.user).not.toBeNull();
    get.mockRejectedValue({ message: 'Network Error' });
    const second = mount();
    await act(async () => { await Promise.resolve(); });
    expect(second.result.current.user).not.toBeNull();
  });

  it('ignores the server’s answer once the page has gone', async () => {
    signIn();
    let reject!: (reason: unknown) => void;
    get.mockReturnValue(new Promise((_resolve, rej) => { reject = rej; }));
    const { unmount } = mount();
    unmount();
    reject(unauthorised);
    await act(async () => { await Promise.resolve(); });
    expect(localStorage.getItem('mg.auth')).not.toBeNull();
  });
});

describe('signing in', () => {
  it('signs in with email and password, storing the login and showing loading meanwhile', async () => {
    let finish!: (value: { data: StoredAuth }) => void;
    post.mockReturnValue(new Promise((resolve) => { finish = resolve as typeof finish; }));
    const { result } = mount();
    let pending!: Promise<void>;
    act(() => { pending = result.current.login('ann@example.com', 'pw'); });
    expect(result.current.loading).toBe(true);
    await act(async () => { finish({ data: stored() }); await pending; });
    expect(post).toHaveBeenCalledWith('/auth/login', { email: 'ann@example.com', password: 'pw' });
    expect(result.current).toMatchObject({ loading: false, token: 'tok-1' });
    expect(JSON.parse(localStorage.getItem('mg.auth')!).token).toBe('tok-1');
  });

  it('passes a failed sign-in on to the caller and stops loading', async () => {
    post.mockRejectedValue(new Error('Invalid credentials'));
    const { result } = mount();
    await act(async () => { await expect(result.current.login('a@b.c', 'bad')).rejects.toThrow('Invalid credentials'); });
    expect(result.current).toMatchObject({ user: null, loading: false });
    expect(localStorage.getItem('mg.auth')).toBeNull();
  });

  it('signs in with the shared admin key', async () => {
    post.mockResolvedValue({ data: stored(['Admin']) });
    const { result } = mount();
    await act(async () => { await result.current.loginWithAdminKey('the-key'); });
    expect(post).toHaveBeenCalledWith('/auth/admin-key', { key: 'the-key' });
    expect(result.current.hasRole('Admin')).toBe(true);
  });

  it('clears loading when the admin key is wrong', async () => {
    post.mockRejectedValue(new Error('nope'));
    const { result } = mount();
    await act(async () => { await expect(result.current.loginWithAdminKey('bad')).rejects.toThrow('nope'); });
    expect(result.current.loading).toBe(false);
  });

  it('signs up a trainer and signs them in', async () => {
    post.mockResolvedValue({ data: stored(['Trainer']) });
    const { result } = mount();
    await act(async () => { await result.current.signupTrainer('ann', 'pw', 'Trainer', 'Ashdown'); });
    expect(post).toHaveBeenCalledWith('/auth/signup-trainer', { username: 'ann', password: 'pw', role: 'Trainer', clubName: 'Ashdown' });
    expect(result.current.user?.fullName).toBe('Ann Smith');
  });

  it('clears loading when sign-up fails', async () => {
    post.mockRejectedValue(new Error('taken'));
    const { result } = mount();
    await act(async () => { await expect(result.current.signupTrainer('ann', 'pw')).rejects.toThrow('taken'); });
    expect(result.current).toMatchObject({ loading: false, user: null });
    expect(post).toHaveBeenCalledWith('/auth/signup-trainer', { username: 'ann', password: 'pw', role: undefined, clubName: undefined });
  });

  it('signs out and forgets the login', () => {
    signIn();
    const { result } = mount();
    act(() => result.current.logout());
    expect(result.current.user).toBeNull();
    expect(localStorage.getItem('mg.auth')).toBeNull();
  });
});

describe('roles and permissions', () => {
  it('reports the roles of the signed-in user', () => {
    signIn(['Trainer', 'Manager']);
    const { result } = mount();
    expect(result.current.hasRole('Trainer')).toBe(true);
    expect(result.current.hasRole('Admin')).toBe(false);
  });

  it('has no roles when signed out', () => {
    expect(mount().result.current.hasRole('Admin')).toBe(false);
  });

  it.each([
    [['Admin'], true], [['Trainer'], true], [['Manager'], true], [['Member'], false], [[], false],
  ])('lets %j organise: %s', (roles, expected) => {
    signIn(roles);
    expect(mount().result.current.canOrganise()).toBe(expected);
  });

  it('never lets a signed-out visitor organise', () => {
    expect(mount().result.current.canOrganise()).toBe(false);
  });
});

describe('admin edit mode', () => {
  it('starts in view-only mode', () => {
    signIn(['Admin']);
    const { result } = mount();
    expect(result.current).toMatchObject({ editorMode: false });
    expect(result.current.canEdit()).toBe(false);
  });

  it('lets an admin switch it on and off, remembering the choice', () => {
    signIn(['Admin']);
    const { result } = mount();
    act(() => result.current.setEditorMode(true));
    expect(result.current.editorMode).toBe(true);
    expect(result.current.canEdit()).toBe(true);
    expect(localStorage.getItem('mg.adminEditorMode')).toBe('1');
    act(() => result.current.setEditorMode(false));
    expect(result.current.canEdit()).toBe(false);
    expect(localStorage.getItem('mg.adminEditorMode')).toBeNull();
  });

  it('restores edit mode for a signed-in admin', () => {
    signIn(['Admin']);
    localStorage.setItem('mg.adminEditorMode', '1');
    expect(mount().result.current.canEdit()).toBe(true);
  });

  it('never turns on for anyone who is not an admin', () => {
    signIn(['Trainer']);
    const { result } = mount();
    act(() => result.current.setEditorMode(true));
    expect(result.current.editorMode).toBe(false);
    expect(result.current.canEdit()).toBe(false);
    expect(localStorage.getItem('mg.adminEditorMode')).toBeNull();
  });

  it('is not inherited by the next person after signing out', () => {
    signIn(['Admin']);
    const { result } = mount();
    act(() => result.current.setEditorMode(true));
    act(() => result.current.logout());
    expect(result.current.editorMode).toBe(false);
    expect(localStorage.getItem('mg.adminEditorMode')).toBeNull();
  });

  it('is discarded when nobody is signed in', () => {
    localStorage.setItem('mg.adminEditorMode', '1');
    const { result } = mount();
    expect(result.current.editorMode).toBe(false);
    expect(localStorage.getItem('mg.adminEditorMode')).toBeNull();
  });

  it('carries on when storage is blocked', () => {
    signIn(['Admin']);
    const realGet = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function getItem(this: Storage, key: string) {
      if (key === 'mg.adminEditorMode') throw new Error('blocked');
      return realGet.call(this, key);
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    const { result } = mount();
    expect(result.current.editorMode).toBe(false);
    act(() => result.current.setEditorMode(true));
    expect(result.current.editorMode).toBe(true);
    act(() => result.current.setEditorMode(false));
    expect(result.current.editorMode).toBe(false);
  });

  it('carries on when signing out with storage blocked', () => {
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => mount()).not.toThrow();
    expect(removeItem).toHaveBeenCalled();
  });
});
