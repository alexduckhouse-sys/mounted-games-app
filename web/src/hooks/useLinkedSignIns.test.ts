import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { useLinkedSignIns } from './useLinkedSignIns';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const del = vi.mocked(api.delete);
const withGoogle = { hasPassword: true, logins: [{ provider: 'google', name: 'Google' }] };
const none = { hasPassword: true, logins: [] };

beforeEach(() => {
  get.mockResolvedValue({ data: withGoogle });
});

describe('useLinkedSignIns', () => {
  it('reads how the person can sign in', async () => {
    const { result } = renderHook(() => useLinkedSignIns());
    expect(result.current.info).toBeNull();
    await waitFor(() => expect(result.current.info).toEqual(withGoogle));
    expect(get).toHaveBeenCalledWith('/auth/logins');
  });

  it('stays empty when the reply is odd or doesn’t come, or the page has gone', async () => {
    for (const reply of [{ hasPassword: 'yes', logins: [] }, { hasPassword: true, logins: [{ provider: 1 }] }, null]) {
      get.mockResolvedValueOnce({ data: reply });
      const { result } = renderHook(() => useLinkedSignIns());
      await waitFor(() => expect(get).toHaveBeenCalled());
      await act(async () => { await Promise.resolve(); });
      expect(result.current.info).toBeNull();
      get.mockClear();
    }
    get.mockRejectedValueOnce(new Error('offline'));
    const offline = renderHook(() => useLinkedSignIns());
    await act(async () => { await Promise.resolve(); });
    expect(offline.result.current.info).toBeNull();

    let answer!: (value: { data: unknown }) => void;
    get.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const gone = renderHook(() => useLinkedSignIns());
    gone.unmount();
    await act(async () => { answer({ data: withGoogle }); });
    expect(gone.result.current.info).toBeNull();
  });

  it('connects and removes with proof it’s the owner, and keeps the fresh sign-in that comes back', async () => {
    const onSession = vi.fn();
    const { result } = renderHook(() => useLinkedSignIns(onSession));
    await waitFor(() => expect(result.current.info).toEqual(withGoogle));

    const auth = { token: 'fresh', expiresAt: '2026-10-28T00:00:00Z', user: { id: 'u1' } };
    post.mockResolvedValueOnce({ data: { hasPassword: true, logins: [...withGoogle.logins, { provider: 'apple', name: 'Apple' }], auth } });
    await act(async () => { await result.current.connect({ provider: 'apple', idToken: 'apple-token', nonce: 'raw' }, { password: 'pw' }); });
    expect(post).toHaveBeenCalledWith('/auth/logins', { provider: 'apple', idToken: 'apple-token', nonce: 'raw', confirm: { password: 'pw' } });
    expect(result.current.info).toEqual({ hasPassword: true, logins: [...withGoogle.logins, { provider: 'apple', name: 'Apple' }] });
    expect(onSession).toHaveBeenCalledWith(auth);

    del.mockResolvedValueOnce({ data: { ...none, auth: null } });
    await act(async () => { await result.current.remove('google', { provider: 'apple', idToken: 'a2', nonce: 'n2' }); });
    expect(del).toHaveBeenCalledWith('/auth/logins/google', { data: { provider: 'apple', idToken: 'a2', nonce: 'n2' } });
    expect(result.current.info).toEqual(none);
    // No fresh sign-in in that reply, so nothing to keep.
    expect(onSession).toHaveBeenCalledTimes(1);

    // An odd reply leaves things as they were; a refusal is thrown for the page to show.
    post.mockResolvedValueOnce({ data: 'nope' });
    await act(async () => { await result.current.connect({ provider: 'google', idToken: 't', nonce: 'n' }, { password: 'pw' }); });
    del.mockResolvedValueOnce({ data: 'nope' });
    await act(async () => { await result.current.remove('apple', { password: 'pw' }); });
    expect(result.current.info).toEqual(none);
    del.mockRejectedValueOnce({ response: { status: 409, data: { message: 'only way in' } } });
    await act(async () => { await expect(result.current.remove('apple', { password: 'pw' })).rejects.toEqual({ response: { status: 409, data: { message: 'only way in' } } }); });
  });

  it('works without anyone to hand a fresh sign-in to', async () => {
    const { result } = renderHook(() => useLinkedSignIns());
    await waitFor(() => expect(result.current.info).toEqual(withGoogle));
    post.mockResolvedValueOnce({ data: { ...none, auth: { token: 'fresh', expiresAt: 'x', user: { id: 'u1' } } } });
    await act(async () => { await result.current.connect({ provider: 'apple', idToken: 't' }, { password: 'pw' }); });
    expect(result.current.info).toEqual(none);
  });
});
