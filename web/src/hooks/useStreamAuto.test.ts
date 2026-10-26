import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_AUTO, loadAuto } from '../lib/streamAuto';
import { useStreamAuto } from './useStreamAuto';

describe('useStreamAuto', () => {
  beforeEach(() => localStorage.clear());

  it('starts off, then saves the switch and each rule for this competition', () => {
    const { result } = renderHook(() => useStreamAuto(3));
    expect(result.current.auto).toEqual(DEFAULT_AUTO);
    act(() => result.current.setOn(true));
    act(() => result.current.setRule('race', { n: 30 }));
    act(() => result.current.setRule('sponsor', { on: true }));
    expect(result.current.auto.on).toBe(true);
    expect(result.current.auto.rules.race.n).toBe(30);
    expect(loadAuto(3)).toEqual(result.current.auto);
    expect(loadAuto(4)).toEqual(DEFAULT_AUTO);
  });

  it('loads the other competition’s choices when the id changes', () => {
    const { result, rerender } = renderHook(({ id }) => useStreamAuto(id), { initialProps: { id: 1 } });
    act(() => result.current.setOn(true));
    rerender({ id: 2 });
    expect(result.current.auto.on).toBe(false);
    rerender({ id: 1 });
    expect(result.current.auto.on).toBe(true);
  });
});
