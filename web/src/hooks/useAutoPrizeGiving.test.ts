import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { competition, heat, race, result, session, standing, team } from '../test/factories';
import { AUTO_CHAMPION_SECONDS, AUTO_PLACE_SECONDS } from '../lib/prizeGiving';
import { useAutoPrizeGiving } from './useAutoPrizeGiving';

const get = vi.hoisted(() => vi.fn());
vi.mock('../api', () => ({ api: { get } }));

const section = { id: 5, displayName: 'Seniors', ageGroup: 'Seniors' } as never;
const teams = [team(1), team(2), team(3)];
const final = (complete: boolean) => session(2, {
  orderIndex: 2, competitionSectionId: 5,
  heats: [heat(2, {
    label: 'A Final', entries: teams.map((t, i) => ({ id: t.id, teamId: t.id, teamName: t.displayName, laneIndex: i })),
    races: [race(20, { isComplete: complete, results: complete ? [result(1, 1, { points: 3 }), result(2, 2, { points: 2 }), result(3, 3, { points: 1 })] : [] })],
  })],
});
const qualifying = session(1, { orderIndex: 1, competitionSectionId: 5, heats: [heat(1, { races: [race(10, { isComplete: true })] })] });
const comp = (complete: boolean) => competition({ sections: [section], teams, sessions: [qualifying, final(complete)] });
const rows = [standing(1, 13), standing(2, 12), standing(3, 11)];

type Props = { complete: boolean; enabled: boolean; manual: boolean };
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const mount = (initial: Props) => renderHook((p: Props) => useAutoPrizeGiving({ competition: comp(p.complete), enabled: p.enabled, manual: p.manual }), { initialProps: initial });

describe('useAutoPrizeGiving', () => {
  beforeEach(() => { vi.useFakeTimers(); get.mockReset(); get.mockResolvedValue({ data: rows }); });
  afterEach(() => vi.useRealTimers());

  it('plays the places last to first, holds the winners, then clears', async () => {
    const hook = mount({ complete: false, enabled: true, manual: false });
    expect(hook.result.current).toBeNull();
    hook.rerender({ complete: true, enabled: true, manual: false });
    await flush();
    expect(get).toHaveBeenCalledWith('/competitions/1/standings', { params: { sectionId: 5 } });
    expect(hook.result.current?.places.map((p) => p.teamId)).toEqual([3]);
    expect(hook.result.current?.sectionName).toBe('Seniors');
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_PLACE_SECONDS * 1000); });
    expect(hook.result.current?.places.map((p) => p.teamId)).toEqual([3, 2]);
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_PLACE_SECONDS * 1000); });
    expect(hook.result.current?.champions).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_CHAMPION_SECONDS * 1000); });
    expect(hook.result.current).toBeNull();
  });

  it('does not replay a final that was already scored when the page opened', async () => {
    const hook = mount({ complete: true, enabled: true, manual: false });
    hook.rerender({ complete: true, enabled: true, manual: false });
    await flush();
    expect(get).not.toHaveBeenCalled();
    expect(hook.result.current).toBeNull();
  });

  it('stays quiet when switched off, and steps aside for a prize-giving run by hand', async () => {
    const off = mount({ complete: false, enabled: false, manual: false });
    off.rerender({ complete: true, enabled: false, manual: false });
    await flush();
    expect(get).not.toHaveBeenCalled();

    const hand = mount({ complete: false, enabled: true, manual: false });
    hand.rerender({ complete: true, enabled: true, manual: false });
    await flush();
    expect(hand.result.current).not.toBeNull();
    hand.rerender({ complete: true, enabled: true, manual: true });
    await flush();
    expect(hand.result.current).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(hand.result.current).toBeNull();
  });

  it('gives up quietly on a failed or malformed standings answer', async () => {
    get.mockRejectedValueOnce(new Error('offline'));
    const failed = mount({ complete: false, enabled: true, manual: false });
    failed.rerender({ complete: true, enabled: true, manual: false });
    await flush();
    expect(failed.result.current).toBeNull();

    get.mockResolvedValueOnce({ data: [{ nope: true }] });
    const bad = mount({ complete: false, enabled: true, manual: false });
    bad.rerender({ complete: true, enabled: true, manual: false });
    await flush();
    expect(bad.result.current).toBeNull();
  });

  it('shows nothing without a competition', () => {
    const { result: out } = renderHook(() => useAutoPrizeGiving({ competition: null, enabled: true, manual: false }));
    expect(out.current).toBeNull();
  });
});
