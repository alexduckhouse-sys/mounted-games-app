import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, writeStoredAuth, type StoredAuth } from '../api';
import { unsubscribeFromPush } from '../lib/push';
import { AuthProvider, useAuth } from './AuthContext';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn(), post: vi.fn() },
}));
vi.mock('../lib/push', () => ({ unsubscribeFromPush: vi.fn().mockResolvedValue(undefined) }));
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

beforeEach(() => { get.mockResolvedValue({ data: stored().user }); });

describe('useAuth', () => {
  it('must be used inside the provider', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useAuth())).toThrow('useAuth must be used within AuthProvider');
    error.mockRestore();
  });

  it('starts signed out', () => {
    const { result } = mount();
    expect(result.current).toMatchObject({ user: null, token: null, loading: false });
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
    await act(async () => { await result.current.loginWithAdminKey('the-key', 'Chief Steward', 'steward@example.com', 'Passw0rd!x'); });
    expect(post).toHaveBeenCalledWith('/auth/admin-key', { key: 'the-key', title: 'Chief Steward', email: 'steward@example.com', password: 'Passw0rd!x' });
  });

  it('accepts an invitation and signs the person in', async () => {
    post.mockResolvedValue({ data: stored(['Trainer']) });
    const { result } = mount();
    await act(async () => { await result.current.acceptInvite('tok', 'Ann Smith', 'Passw0rd!x'); });
    expect(post).toHaveBeenCalledWith('/auth/invites/accept', { token: 'tok', fullName: 'Ann Smith', password: 'Passw0rd!x' });
    expect(result.current.hasRole('Trainer')).toBe(true);
    expect(JSON.parse(localStorage.getItem('mg.auth') ?? '{}').token).toBe('tok-1');
  });

  it('changes the password and swaps in the fresh sign-in the server sends back', async () => {
    signIn();
    const { result } = mount();
    post.mockResolvedValueOnce({ data: { ...stored(), token: 'tok-2' } });
    await act(async () => { await result.current.changePassword('old-Passw0rd!', 'New-passw0rd!'); });
    expect(post).toHaveBeenCalledWith('/auth/change-password', { currentPassword: 'old-Passw0rd!', newPassword: 'New-passw0rd!' });
    expect(result.current.token).toBe('tok-2');
    expect(JSON.parse(localStorage.getItem('mg.auth') ?? '{}').token).toBe('tok-2');

    // An older API's empty answer, or a reply without a sign-in, keeps the one this device has.
    for (const data of [undefined, '', { token: 'tok-3' }, { user: stored().user }]) {
      post.mockResolvedValueOnce({ data });
      await act(async () => { await result.current.changePassword('a', 'b'); });
      expect(result.current.token).toBe('tok-2');
    }

    post.mockRejectedValueOnce(new Error('wrong password'));
    await act(async () => { await expect(result.current.changePassword('a', 'b')).rejects.toThrow('wrong password'); });
    expect(result.current.token).toBe('tok-2');
  });

  it('adopts a fresh sign-in handed to it, and ignores anything that isn’t one', async () => {
    signIn();
    const { result } = mount();
    act(() => result.current.adoptSession({ ...stored(), token: 'tok-9' } as never));
    expect(result.current.token).toBe('tok-9');
    expect(JSON.parse(localStorage.getItem('mg.auth') ?? '{}').token).toBe('tok-9');
    for (const odd of [null, { token: 'tok-10' }, { user: stored().user }]) {
      act(() => result.current.adoptSession(odd as never));
      expect(result.current.token).toBe('tok-9');
    }
  });

  it('clears loading when an invitation is refused', async () => {
    post.mockRejectedValue(new Error('gone'));
    const { result } = mount();
    await act(async () => { await expect(result.current.acceptInvite('tok', 'A', 'bad')).rejects.toThrow('gone'); });
    expect(result.current).toMatchObject({ user: null, loading: false });
  });

  it('clears loading when the admin key is wrong', async () => {
    post.mockRejectedValue(new Error('nope'));
    const { result } = mount();
    await act(async () => { await expect(result.current.loginWithAdminKey('bad')).rejects.toThrow('nope'); });
    expect(result.current.loading).toBe(false);
  });

  it('signs in with an external provider when the account exists, or hands back a sign-up ticket when it doesn’t', async () => {
    post.mockResolvedValueOnce({
      data: { needsSignup: true, auth: null, email: 'new@example.com', suggestedName: 'New Rider', provider: 'google', signupTicket: 'ticket-1' },
    });
    const { result } = mount();
    let step1!: Awaited<ReturnType<typeof result.current.loginWithExternal>>;
    await act(async () => {
      step1 = await result.current.loginWithExternal('google', 'id-tok-1', { nonce: 'n-1' });
    });
    expect(post).toHaveBeenCalledWith('/auth/external', { provider: 'google', idToken: 'id-tok-1', nonce: 'n-1' });
    expect(step1).toEqual({ needsSignup: true, email: 'new@example.com', suggestedName: 'New Rider', provider: 'google', ticket: 'ticket-1' });
    expect(result.current.user).toBeNull();

    // Fallback defaults when the server leaves optional fields out, but never without a ticket.
    post.mockResolvedValueOnce({ data: { needsSignup: true, auth: null, signupTicket: 'ticket-2' } });
    await act(async () => {
      step1 = await result.current.loginWithExternal('apple', 'id-tok-2');
    });
    expect(step1).toEqual({ needsSignup: true, email: '', suggestedName: '', provider: 'apple', ticket: 'ticket-2' });
    post.mockResolvedValueOnce({ data: { needsSignup: true, auth: null } });
    await act(async () => {
      await expect(result.current.loginWithExternal('apple', 'id-tok-3')).rejects.toThrow('sign-up ticket');
    });

    // Finishing with the ticket stores the session and raises the notice for a trainer request.
    post.mockResolvedValueOnce({ data: stored(['Member', 'TrainerRequest']) });
    get.mockResolvedValue({ data: stored(['Member', 'TrainerRequest']).user });
    let profile!: Awaited<ReturnType<typeof result.current.completeExternalSignup>>;
    await act(async () => {
      profile = await result.current.completeExternalSignup('ticket-1', { fullName: 'Ann Smith', clubName: 'Ashdown', role: 'Trainer' });
    });
    expect(post).toHaveBeenLastCalledWith('/auth/external/signup', { ticket: 'ticket-1', fullName: 'Ann Smith', clubName: 'Ashdown', role: 'Trainer' });
    expect(profile.email).toBe('ann@example.com');
    expect(result.current.user?.email).toBe('ann@example.com');
    expect(result.current.trainerNotice).toBe('requested');

    // A member sign-in clears the notice.
    post.mockResolvedValueOnce({ data: stored(['Member']) });
    await act(async () => {
      await result.current.completeExternalSignup('ticket-3', { fullName: 'Ann', clubName: 'Ashdown', role: 'Member' });
    });
    expect(post).toHaveBeenLastCalledWith('/auth/external/signup', { ticket: 'ticket-3', fullName: 'Ann', clubName: 'Ashdown', role: 'Member' });
    expect(result.current.trainerNotice).toBeNull();

    post.mockResolvedValueOnce({ data: { needsSignup: false, auth: stored(['Member']) } });
    let step2!: Awaited<ReturnType<typeof result.current.loginWithExternal>>;
    await act(async () => {
      step2 = await result.current.loginWithExternal('google', 'id-tok-4');
    });
    expect(step2).toEqual({ needsSignup: false });
  });

  it('clears loading when finishing an external sign-up fails', async () => {
    post.mockRejectedValue(new Error('ticket expired'));
    const { result } = mount();
    await act(async () => {
      await expect(result.current.completeExternalSignup('old', { fullName: 'A', clubName: 'B', role: 'Member' })).rejects.toThrow('ticket expired');
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it('passes Apple’s first-sign-in name along and refuses a sign-in reply with no session', async () => {
    post.mockResolvedValueOnce({ data: { needsSignup: true, auth: null, email: 'x@privaterelay.appleid.com', suggestedName: 'Sam Taylor', provider: 'apple', signupTicket: 'ticket-a' } });
    const { result } = mount();
    await act(async () => {
      await result.current.loginWithExternal('apple', 'apple-tok', { nonce: 'raw-nonce', providerName: 'Sam Taylor' });
    });
    expect(post).toHaveBeenCalledWith('/auth/external', { provider: 'apple', idToken: 'apple-tok', nonce: 'raw-nonce', providerName: 'Sam Taylor' });

    post.mockResolvedValueOnce({ data: { needsSignup: false, auth: null } });
    await act(async () => {
      await expect(result.current.loginWithExternal('apple', 'apple-tok', { nonce: 'raw-nonce' })).rejects.toThrow('no session');
    });
    expect(result.current.user).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('clears loading when external sign-in fails', async () => {
    post.mockRejectedValue(new Error('invalid token'));
    const { result } = mount();
    await act(async () => {
      await expect(result.current.loginWithExternal('google', 'bad')).rejects.toThrow('invalid token');
    });
    expect(result.current.loading).toBe(false);
  });

  it('signs up a pending trainer as a member and shows the request notice', async () => {
    post.mockResolvedValue({ data: stored(['Member', 'TrainerRequest']) });
    get.mockResolvedValue({ data: stored(['Member', 'TrainerRequest']).user });
    const { result } = mount();
    await act(async () => { await result.current.signupTrainer('ann', 'pw', 'Trainer', 'Ashdown'); });
    expect(post).toHaveBeenCalledWith('/auth/signup-trainer', { username: 'ann', password: 'pw', role: 'Trainer', clubName: 'Ashdown', fullName: undefined });
    expect(result.current.user?.fullName).toBe('Ann Smith');
    expect(result.current.trainerNotice).toBe('requested');
    expect(result.current.hasRole('Member')).toBe(true);
    expect(result.current.canOrganise()).toBe(false);
  });

  it('sends the person\'s own name when there is one', async () => {
    post.mockResolvedValue({ data: stored(['Member']) });
    const { result } = mount();
    await act(async () => { await result.current.signupTrainer('ann@example.com', 'pw', 'Member', 'Ashdown', 'Ann Smith'); });
    expect(post).toHaveBeenCalledWith('/auth/signup-trainer', { username: 'ann@example.com', password: 'pw', role: 'Member', clubName: 'Ashdown', fullName: 'Ann Smith' });
  });

  it.each(['Manager', 'Member'])('does not show the trainer request notice for %s signup', async (role) => {
    post.mockResolvedValue({ data: stored([role]) });
    const { result } = mount();
    await act(async () => { await result.current.signupTrainer('test-user', 'pw', role); });
    expect(result.current.trainerNotice).toBeNull();
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

  it('drops the push subscription and the alerts flag on sign-out', () => {
    signIn();
    localStorage.setItem('mg.notify.enabled', '1');
    const { result } = mount();
    act(() => result.current.logout());
    expect(unsubscribeFromPush).toHaveBeenCalledWith('tok-1');
    expect(localStorage.getItem('mg.notify.enabled')).toBeNull();
  });

  it('clears unfinished entry drafts on sign-out but leaves other storage alone', () => {
    signIn();
    localStorage.setItem('mg.draft.entry.v1.["u",1,5,"standard"]', '{}');
    localStorage.setItem('mg.draft.entry.v1.other', '{}');
    localStorage.setItem('mg.other', 'keep');
    const { result } = mount();
    act(() => result.current.logout());
    expect(Object.keys(localStorage).filter((k) => k.startsWith('mg.draft.entry.v1.'))).toEqual([]);
    expect(localStorage.getItem('mg.other')).toBe('keep');
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
    [['Admin'], true], [['Trainer'], true], [['Manager'], false], [['Member'], false],
    [['TrainerRequest'], false], [['Member', 'TrainerRequest'], false], [[], false],
  ])('lets %j organise: %s', (roles, expected) => {
    signIn(roles);
    expect(mount().result.current.canOrganise()).toBe(expected);
  });

  it('lets a trainer organise only the competitions they created; admins organise any', () => {
    signIn(['Trainer']);
    const trainer = mount().result.current;
    const ownId = trainer.user!.id;
    expect(trainer.canOrganise({ createdByUserId: ownId })).toBe(true);
    expect(trainer.canOrganise({ createdByUserId: 'someone-else' })).toBe(false);
    expect(trainer.canOrganise({ createdByUserId: null })).toBe(false);
    signIn(['Admin']);
    expect(mount().result.current.canOrganise({ createdByUserId: 'someone-else' })).toBe(true);
  });

  it('never lets a signed-out visitor organise', () => {
    expect(mount().result.current.canOrganise()).toBe(false);
  });
});

describe('trainer approval notice', () => {
  it('detects approval without changing the stored JWT roles or organiser permissions', async () => {
    signIn(['Member', 'TrainerRequest']);
    const { result } = mount();
    await waitFor(() => expect(result.current.trainerNotice).toBe('approved'));
    expect(result.current.canOrganise()).toBe(false);
    expect(result.current.user?.roles).toEqual(['Member', 'TrainerRequest']);
    expect(JSON.parse(localStorage.getItem('mg.auth')!).user.roles).toEqual(['Member', 'TrainerRequest']);
    act(() => result.current.logout());
    expect(result.current.trainerNotice).toBeNull();
  });

  it.each([['Member', 'TrainerRequest'], ['Member']])('shows no approval notice when the current roles are %j', async (...roles) => {
    signIn(['Member', 'TrainerRequest']);
    get.mockResolvedValue({ data: stored(roles).user });
    const { result } = mount();
    await act(async () => { await Promise.resolve(); });
    expect(result.current.trainerNotice).toBeNull();
  });

  it('does not show an approval notice to an existing trainer', async () => {
    signIn(['Trainer']);
    const { result } = mount();
    await act(async () => { await Promise.resolve(); });
    expect(result.current.trainerNotice).toBeNull();
  });

  it('ignores an approval response after signing out', async () => {
    signIn(['Member', 'TrainerRequest']);
    let finish!: (value: { data: StoredAuth['user'] }) => void;
    get.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { result } = mount();
    act(() => result.current.logout());
    await act(async () => { finish({ data: stored().user }); });
    expect(result.current.trainerNotice).toBeNull();
    expect(result.current.user).toBeNull();
  });

  it('clears the notice and gains organiser permissions after a fresh sign-in', async () => {
    signIn(['Member', 'TrainerRequest']);
    const { result } = mount();
    await waitFor(() => expect(result.current.trainerNotice).toBe('approved'));
    post.mockResolvedValue({ data: { ...stored(), token: 'fresh-trainer-token' } });
    await act(async () => { await result.current.login('test@example.com', 'pw'); });
    expect(result.current.trainerNotice).toBeNull();
    expect(result.current.canOrganise()).toBe(true);
  });
});

describe('admin permissions (there is no edit mode)', () => {
  it('lets an admin edit straight away', () => {
    signIn(['Admin']);
    const { result } = mount();
    expect(result.current.canEdit()).toBe(true);
    expect(result.current).not.toHaveProperty('editorMode');
    expect(result.current).not.toHaveProperty('setEditorMode');
  });

  it('never lets anyone who is not an admin edit', () => {
    signIn(['Trainer']);
    expect(mount().result.current.canEdit()).toBe(false);
  });

  it('clears the old saved edit-mode switch', () => {
    localStorage.setItem('mg.adminEditorMode', '1');
    mount();
    expect(localStorage.getItem('mg.adminEditorMode')).toBeNull();
  });

  it('carries on when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => mount()).not.toThrow();
  });
});

describe('refreshUser', () => {
  it('picks up a confirmed email address and saves it', async () => {
    localStorage.setItem('mg.auth', JSON.stringify(stored(['Member'], { emailConfirmed: false })));
    const { result } = mount();
    expect(result.current.user?.emailConfirmed).toBe(false);
    get.mockResolvedValue({ data: { ...stored(['Member']).user, emailConfirmed: true } });
    await act(async () => { await result.current.refreshUser(); });
    expect(result.current.user?.emailConfirmed).toBe(true);
    expect(JSON.parse(localStorage.getItem('mg.auth')!).user.emailConfirmed).toBe(true);
  });

  it('ignores a profile for someone else, a failure, and being signed out', async () => {
    signIn();
    const { result } = mount();
    get.mockResolvedValue({ data: { ...stored().user, id: 'other', emailConfirmed: false } });
    await act(async () => { await result.current.refreshUser(); });
    expect(result.current.user?.id).toBe('u1');
    get.mockRejectedValue(new Error('offline'));
    await act(async () => { await result.current.refreshUser(); });
    expect(result.current.user?.id).toBe('u1');
    act(() => result.current.logout());
    get.mockResolvedValue({ data: stored().user });
    await act(async () => { await result.current.refreshUser(); });
    expect(result.current.user).toBeNull();
  });
});

describe('shared-browser auth boundaries', () => {
  it('drops the mounted account when another tab signs out', async () => {
    signIn(); const { result } = mount();
    await act(async () => { localStorage.removeItem('mg.auth'); window.dispatchEvent(new StorageEvent('storage', { key: 'mg.auth' })); });
    expect(result.current.user).toBeNull();
  });
  it('switches the mounted account when another tab signs in', async () => {
    signIn(); const { result } = mount();
    await act(async () => { localStorage.setItem('mg.auth', JSON.stringify(stored(['Member'], { id: 'fake-user-b' }))); window.dispatchEvent(new StorageEvent('storage', { key: 'mg.auth' })); });
    expect(result.current.user?.id).toBe('fake-user-b');
  });
  it('clears mounted private views and drafts when the API rejects a session', async () => {
    signIn(); const { result } = mount();
    for (const key of ['mg.draft.decform.v3:fake:1:2', 'competitionEditor:new', 'mg.draft.admin-email']) localStorage.setItem(key, 'private fake draft');
    await act(async () => { writeStoredAuth(null); });
    expect(result.current.user).toBeNull();
    expect(Object.keys(localStorage).some((key) => key.startsWith('mg.draft.') || key.startsWith('competitionEditor:'))).toBe(false);
  });
});
