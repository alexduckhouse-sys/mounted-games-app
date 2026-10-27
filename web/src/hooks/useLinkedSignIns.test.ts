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

  it('connects with the provider’s token and raw nonce, and removes by provider', async () => {
    const { result } = renderHook(() => useLinkedSignIns());
    await waitFor(() => expect(result.current.info).toEqual(withGoogle));

    post.mockResolvedValueOnce({ data: { hasPassword: true, logins: [...withGoogle.logins, { provider: 'apple', name: 'Apple' }] } });
    await act(async () => { await result.current.connect({ provider: 'apple', idToken: 'apple-token', nonce: 'raw' }); });
    expect(post).toHaveBeenCalledWith('/auth/logins', { provider: 'apple', idToken: 'apple-token', nonce: 'raw' });
    expect(result.current.info?.logins.map((l) => l.provider)).toEqual(['google', 'apple']);

    del.mockResolvedValueOnce({ data: none });
    await act(async () => { await result.current.remove('google'); });
    expect(del).toHaveBeenCalledWith('/auth/logins/google');
    expect(result.current.info).toEqual(none);

    // An odd reply leaves things as they were; a refusal is thrown for the page to show.
    post.mockResolvedValueOnce({ data: 'nope' });
    await act(async () => { await result.current.connect({ provider: 'google', idToken: 't', nonce: 'n' }); });
    del.mockResolvedValueOnce({ data: 'nope' });
    await act(async () => { await result.current.remove('apple'); });
    expect(result.current.info).toEqual(none);
    del.mockRejectedValueOnce({ response: { status: 409, data: { message: 'only way in' } } });
    await act(async () => { await expect(result.current.remove('apple')).rejects.toEqual({ response: { status: 409, data: { message: 'only way in' } } }); });
  });
});
