import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FOLLOWED_PROFILES_KEY } from '../lib/followedProfiles';
import { useFollowedProfiles } from './useFollowedProfiles';

const north = { id: 'north-a', name: 'North Club A', clubName: 'North Club' };

describe('useFollowedProfiles', () => {
  it('keeps two views in sync and stops listening after unmount', () => {
    const first = renderHook(useFollowedProfiles);
    const second = renderHook(useFollowedProfiles);
    act(() => first.result.current.toggle(north));
    expect(second.result.current.profiles).toEqual([north]);
    expect(second.result.current.isFollowed('north-a')).toBe(true);
    expect(second.result.current.isFollowed('other')).toBe(false);
    second.unmount();
    act(() => first.result.current.set(north, false));
    expect(first.result.current.profiles).toEqual([]);
    expect(second.result.current.profiles).toHaveLength(1);
  });

  it('follows a change or a clear made in another tab, and ignores unrelated keys', () => {
    const { result } = renderHook(useFollowedProfiles);
    act(() => {
      localStorage.setItem(FOLLOWED_PROFILES_KEY, JSON.stringify([north]));
      window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }));
    });
    expect(result.current.profiles).toEqual([]);
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: FOLLOWED_PROFILES_KEY })));
    expect(result.current.profiles).toEqual([north]);
    act(() => { localStorage.clear(); window.dispatchEvent(new StorageEvent('storage', { key: null })); });
    expect(result.current.profiles).toEqual([]);
  });

  it('shows a storage error and clears it after a successful retry', () => {
    const { result } = renderHook(useFollowedProfiles);
    const block = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    act(() => result.current.toggle(north));
    expect(result.current.error).toMatch(/couldn’t be saved/);
    block.mockRestore();
    act(() => result.current.toggle(north));
    expect(result.current.error).toBeNull();
  });
});
