import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { scorerApi } from '../offline/scorerLink';
import type { Session } from '../types';
import { useGateCheck } from './useGateCheck';

vi.mock('../api', () => ({ api: { put: vi.fn() } }));
vi.mock('../offline/scorerLink', () => ({ scorerApi: { put: vi.fn() } }));

const heat = {
  id: 10,
  entries: [
    { id: 1, teamId: 101, teamName: 'A', laneIndex: 1 },
    { id: 2, teamId: 102, teamName: 'B', laneIndex: 2 },
  ],
};

describe('useGateCheck branches', () => {
  beforeEach(() => {
    vi.mocked(api.put).mockReset();
    vi.mocked(scorerApi.put).mockReset();
  });

  it('uses the scorer endpoint for a link, clears the optimistic value on success and works without a callback', async () => {
    const saved = { id: 5, notes: '[gate:10:101=warming-up]' } as Session;
    vi.mocked(scorerApi.put).mockResolvedValueOnce({ data: saved } as never);
    const { result } = renderHook(() => useGateCheck({ viaLink: true }));
    let returned: Session | null = null;
    await act(async () => {
      returned = await result.current.setStatus({ id: 5, notes: null }, 10, 101, 'warming-up');
    });
    expect(returned).toEqual(saved);
    expect(scorerApi.put).toHaveBeenCalledWith('/scorer/heats/10/gate-check', { teamId: 101, status: 'warming-up' });
    expect(api.put).not.toHaveBeenCalled();
    // optimistic entry removed: status now comes from the session notes again
    expect(result.current.getStatus({ notes: null }, 10, 101)).toBeNull();
    expect(result.current.getStatus({ notes: saved.notes }, 10, 101)).toBe('warming-up');
    expect(result.current.savingKey).toBeNull();
  });

  it('does not send or optimistically apply a change without a competition or scorer link', async () => {
    const { result } = renderHook(() => useGateCheck());
    await act(async () => {
      expect(await result.current.setStatus({ id: 1, notes: null }, 10, 101, 'missing')).toBeNull();
    });
    expect(api.put).not.toHaveBeenCalled();
    expect(scorerApi.put).not.toHaveBeenCalled();
    expect(result.current.getStatus({ notes: null }, 10, 101)).toBeNull();
    expect(result.current.savingKey).toBeNull();
    expect(result.current.getStatus({ notes: null }, 10, 102)).toBeNull();
  });

  it('merges optimistic values into the notes when checking readiness, and an empty heat', async () => {
    vi.mocked(api.put).mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useGateCheck({ competitionId: 1 }));
    const session = { id: 5, notes: '[gate:10:101=at-gate]' };
    expect(result.current.isReadyAtGate(session, heat)).toBe(false);
    await act(async () => {
      await result.current.setStatus(session, 10, 102, 'at-gate');
    });
    expect(result.current.isReadyAtGate(session, heat)).toBe(true);
    // an optimistic clear removes a tag already in the notes
    await act(async () => {
      await result.current.setStatus(session, 10, 101, null);
    });
    expect(result.current.isReadyAtGate(session, heat)).toBe(false);
    expect(result.current.isReadyAtGate({ notes: null }, { id: 10, entries: [] })).toBe(false);
  });

  it('cycles from an existing status and keeps another key saving state intact', async () => {
    let finish!: (v: unknown) => void;
    let finishSecond!: (v: unknown) => void;
    vi.mocked(api.put).mockReturnValueOnce(new Promise((r) => (finish = r)) as never);
    vi.mocked(api.put).mockReturnValueOnce(new Promise((r) => (finishSecond = r)) as never);
    const { result } = renderHook(() => useGateCheck({ competitionId: 1 }));
    const session = { id: 5, notes: '[gate:10:101=missing]' };
    let pending!: Promise<Session | null>;
    act(() => {
      pending = result.current.cycleStatus(session, 10, 101);
    });
    expect(result.current.savingKey).toBe('10:101');
    expect(api.put).toHaveBeenCalledWith('/competitions/1/sessions/5/heats/10/gate-check', { teamId: 101, status: null });
    let secondPending!: Promise<Session | null>;
    act(() => {
      secondPending = result.current.setStatus(session, 10, 102, 'at-gate');
    });
    expect(result.current.savingKey).toBe('10:102');
    await act(async () => {
      finish({ data: { id: 5, notes: null } });
      await pending;
    });
    expect(result.current.savingKey).toBe('10:102');
    expect(result.current.getStatus({ notes: null }, 10, 102)).toBe('at-gate');
    await act(async () => {
      finishSecond({ data: { id: 5, notes: '[gate:10:102=at-gate]' } });
      await secondPending;
    });
    expect(result.current.savingKey).toBeNull();
  });
});
