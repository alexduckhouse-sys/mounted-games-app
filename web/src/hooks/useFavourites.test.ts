import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FAVOURITES_KEY, toggleFavourite } from '../lib/favourites';
import { useFavourites } from './useFavourites';

describe('useFavourites', () => {
  it('keeps two views in sync and stops listening after unmount', () => {
    const first = renderHook(useFavourites);
    const second = renderHook(useFavourites);
    act(() => first.result.current.toggle({ competitionId: 1, teamId: 2 }));
    expect(second.result.current.favourites).toEqual([{ competitionId: 1, teamId: 2 }]);
    second.unmount();
    act(() => first.result.current.toggle({ competitionId: 1, teamId: 2 }));
    expect(second.result.current.favourites).toHaveLength(1);
  });
  it('handles changes and clearing storage in another tab', () => {
    const { result } = renderHook(useFavourites);
    act(() => {
      localStorage.setItem(FAVOURITES_KEY, '[{"competitionId":3,"teamId":4}]');
      window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }));
    });
    expect(result.current.favourites).toEqual([]);
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: FAVOURITES_KEY })));
    expect(result.current.favourites).toHaveLength(1);
    act(() => { localStorage.clear(); window.dispatchEvent(new StorageEvent('storage', { key: null })); });
    expect(result.current.favourites).toEqual([]);
  });
  it('shows a storage error and clears it after a successful retry', () => {
    const { result } = renderHook(useFavourites);
    const block = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    act(() => result.current.toggle({ competitionId: 1, teamId: 2 }));
    expect(result.current.error).toMatch(/couldn’t be saved/);
    block.mockRestore();
    act(() => result.current.toggle({ competitionId: 1, teamId: 2 }));
    expect(result.current.error).toBeNull();
    act(() => { toggleFavourite({ competitionId: 1, teamId: 3 }); });
    expect(result.current.favourites).toHaveLength(2);
  });
});
