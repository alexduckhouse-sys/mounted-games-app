import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { useTeamRaceLineup } from './useTeamRaceLineup';

vi.mock('../api', () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
  },
}));

const KEY = 'mg:team-race-lineup:7:12';
const plan = { '201': { '101': '1', '102': 'sit-out' } };

describe('useTeamRaceLineup branches', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.put).mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing without ids and keeps saves local', async () => {
    const { result } = renderHook(() => useTeamRaceLineup(null, undefined));
    expect(result.current.assignments).toEqual({});
    expect(api.get).not.toHaveBeenCalled();
    let returned: unknown;
    await act(async () => {
      returned = await result.current.saveAssignments(plan);
    });
    expect(returned).toEqual(plan);
    expect(result.current.assignments).toEqual(plan);
    expect(api.put).not.toHaveBeenCalled();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('starts from the stored plan and ignores a malformed or non-object one', async () => {
    localStorage.setItem(KEY, JSON.stringify(plan));
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}) as never);
    const stored = renderHook(() => useTeamRaceLineup(7, 12));
    expect(stored.result.current.assignments).toEqual(plan);
    stored.unmount();

    localStorage.setItem(KEY, '[1,2]');
    expect(renderHook(() => useTeamRaceLineup(7, 12)).result.current.assignments).toEqual({});
    localStorage.setItem(KEY, 'not json');
    expect(renderHook(() => useTeamRaceLineup(7, 12)).result.current.assignments).toEqual({});
    localStorage.setItem(KEY, 'null');
    expect(renderHook(() => useTeamRaceLineup(7, 12)).result.current.assignments).toEqual({});
  });

  it('accepts an unwrapped response, stores it and records updatedAt', async () => {
    vi.mocked(api.get).mockResolvedValue({ competitionId: 7, teamId: 12, assignments: plan, updatedAt: '2026-10-26T12:00:00Z' } as never);
    const { result } = renderHook(() => useTeamRaceLineup(7, 12));
    await waitFor(() => expect(result.current.updatedAt).toBe('2026-10-26T12:00:00Z'));
    expect(result.current.assignments).toEqual(plan);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(plan);
  });

  it('keeps the local plan when the server has an empty, never-saved one', async () => {
    localStorage.setItem(KEY, JSON.stringify(plan));
    vi.mocked(api.get).mockResolvedValue({ data: { assignments: {}, updatedAt: null } } as never);
    const { result } = renderHook(() => useTeamRaceLineup(7, 12));
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.assignments).toEqual(plan);
    expect(result.current.updatedAt).toBeNull();
  });

  it('takes an empty server plan that has been saved before (has updatedAt)', async () => {
    localStorage.setItem(KEY, JSON.stringify(plan));
    vi.mocked(api.get).mockResolvedValue({ data: { assignments: {}, updatedAt: '2026-10-26T09:00:00Z' } } as never);
    const { result } = renderHook(() => useTeamRaceLineup(7, 12));
    await waitFor(() => expect(result.current.updatedAt).toBe('2026-10-26T09:00:00Z'));
    expect(result.current.assignments).toEqual({});
  });

  it('ignores responses without usable assignments', async () => {
    for (const body of [undefined, { data: {} }, { data: { assignments: null } }, { data: { assignments: 'x' } }]) {
      vi.mocked(api.get).mockResolvedValue(body as never);
      const { result, unmount } = renderHook(() => useTeamRaceLineup(7, 12));
      await waitFor(() => expect(api.get).toHaveBeenCalled());
      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.assignments).toEqual({});
      expect(result.current.updatedAt).toBeNull();
      unmount();
      vi.mocked(api.get).mockReset();
    }
  });

  it('falls back to the stored plan if the request fails', async () => {
    localStorage.setItem(KEY, JSON.stringify(plan));
    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useTeamRaceLineup(7, 12));
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(result.current.assignments).toEqual(plan);
  });

  it('ignores a late response after unmount', async () => {
    let resolve!: (v: unknown) => void;
    vi.mocked(api.get).mockReturnValue(new Promise((r) => (resolve = r)) as never);
    const { result, unmount } = renderHook(() => useTeamRaceLineup(7, 12));
    unmount();
    await act(async () => {
      resolve({ data: { assignments: plan, updatedAt: 'x' } });
      await Promise.resolve();
    });
    expect(result.current.assignments).toEqual({});
    expect(localStorage.getItem(KEY)).toBeNull();

    let reject!: (e: unknown) => void;
    vi.mocked(api.get).mockReturnValue(new Promise((_r, rj) => (reject = rj)) as never);
    const second = renderHook(() => useTeamRaceLineup(7, 12));
    second.unmount();
    await act(async () => {
      reject(new Error('late'));
      await Promise.resolve();
    });
    expect(second.result.current.assignments).toEqual({});
  });

  it('saves from the server reply, or the request when the reply has no assignments', async () => {
    vi.mocked(api.get).mockResolvedValue(undefined as never);
    const { result } = renderHook(() => useTeamRaceLineup(7, 12));

    vi.mocked(api.put).mockResolvedValueOnce({ assignments: { '9': { '1': '1' } } } as never);
    let saved: unknown;
    await act(async () => {
      saved = await result.current.saveAssignments(plan);
    });
    expect(saved).toEqual({ '9': { '1': '1' } });
    expect(result.current.updatedAt).toBeNull();
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ '9': { '1': '1' } });

    vi.mocked(api.put).mockResolvedValueOnce({ data: {} } as never);
    await act(async () => {
      saved = await result.current.saveAssignments(plan);
    });
    expect(saved).toEqual(plan);
    expect(result.current.assignments).toEqual(plan);
    expect(result.current.saving).toBe(false);
  });

  it('reports a sync failure but keeps the plan on the device', async () => {
    vi.mocked(api.get).mockResolvedValue(undefined as never);
    const { result } = renderHook(() => useTeamRaceLineup(7, 12));
    vi.mocked(api.put).mockRejectedValueOnce(new Error('503'));
    await act(async () => {
      await result.current.saveAssignments(plan);
    });
    expect(result.current.error).toBe('503');
    expect(result.current.assignments).toEqual(plan);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(plan);

    vi.mocked(api.put).mockRejectedValueOnce(new Error(''));
    await act(async () => {
      await result.current.saveAssignments(plan);
    });
    expect(result.current.error).toBe('Saved on this device; could not sync with server.');
  });

  it('skips the network call when the client has no put', async () => {
    vi.mocked(api.get).mockResolvedValue(undefined as never);
    const original = api.put;
    (api as { put?: unknown }).put = undefined;
    try {
      const { result } = renderHook(() => useTeamRaceLineup(7, 12));
      let saved: unknown;
      await act(async () => {
        saved = await result.current.saveAssignments(plan);
      });
      expect(saved).toEqual(plan);
      expect(result.current.saving).toBe(false);
    } finally {
      (api as { put?: unknown }).put = original;
    }
  });

  it('survives storage failures when reading and writing', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    vi.mocked(api.get).mockResolvedValue(undefined as never);
    vi.mocked(api.put).mockResolvedValue({ data: { assignments: plan } } as never);
    const { result } = renderHook(() => useTeamRaceLineup(7, 12));
    expect(result.current.assignments).toEqual({});
    await act(async () => {
      await result.current.saveAssignments(plan);
    });
    expect(result.current.assignments).toEqual(plan);
  });
});
