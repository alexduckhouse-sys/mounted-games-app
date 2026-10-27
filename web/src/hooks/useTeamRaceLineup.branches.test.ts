import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { useTeamRaceLineup } from './useTeamRaceLineup';

vi.mock('../api', () => ({ api: { get: vi.fn(), put: vi.fn() } }));

const KEY = 'mg:team-race-lineup:7:12';
const local = { '300': { '1': '1', '2': 'sit-out' } };

describe('useTeamRaceLineup branches', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.put).mockReset();
    localStorage.clear();
  });

  it('stays empty and silent without ids, and saves nothing remotely', async () => {
    const { result } = renderHook(() => useTeamRaceLineup(null, 12));
    expect(api.get).not.toHaveBeenCalled();
    expect(result.current.assignments).toEqual({});
    let out;
    await act(async () => {
      out = await result.current.saveAssignments(local);
    });
    expect(out).toEqual(local);
    expect(result.current.assignments).toEqual(local);
    expect(api.put).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it('starts from the local copy and keeps it when the server plan is empty', async () => {
    localStorage.setItem(KEY, JSON.stringify(local));
    vi.mocked(api.get).mockResolvedValueOnce({ assignments: {}, updatedAt: null } as never);
    const { result } = renderHook(() => useTeamRaceLineup(7, 12));
    expect(result.current.assignments).toEqual(local);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    await waitFor(() => expect(result.current.updatedAt).toBeNull());
    expect(result.current.assignments).toEqual(local);
  });

  it('accepts an empty server plan that carries updatedAt, replacing local data', async () => {
    localStorage.setItem(KEY, JSON.stringify(local));
    vi.mocked(api.get).mockResolvedValueOnce({ data: { assignments: {}, updatedAt: '2026-10-26T12:00:00Z' } } as never);
    const { result } = renderHook(() => useTeamRaceLineup(7, 12));
    await waitFor(() => expect(result.current.updatedAt).toBe('2026-10-26T12:00:00Z'));
    expect(result.current.assignments).toEqual({});
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({});
  });

  it('ignores malformed server payloads', async () => {
    localStorage.setItem(KEY, JSON.stringify(local));
    vi.mocked(api.get).mockResolvedValueOnce({ data: { assignments: null } } as never);
    const a = renderHook(() => useTeamRaceLineup(7, 12));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    expect(a.result.current.assignments).toEqual(local);

    vi.mocked(api.get).mockResolvedValueOnce({ data: null } as never);
    vi.mocked(api.get).mockResolvedValueOnce(undefined as never);
    renderHook(() => useTeamRaceLineup(7, 12));
    renderHook(() => useTeamRaceLineup(7, 12));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(3));
  });

  it('falls back to the local plan on failure and tolerates corrupt storage', async () => {
    localStorage.setItem(KEY, JSON.stringify(local));
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useTeamRaceLineup(7, 12));
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(result.current.assignments).toEqual(local);

    for (const bad of ['{not json', '[1,2]', '']) {
      localStorage.setItem(KEY, bad);
      vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
      const r = renderHook(() => useTeamRaceLineup(7, 12));
      await waitFor(() => expect(r.result.current.loading).toBe(false));
      expect(r.result.current.assignments).toEqual({});
    }
  });

  it('does not apply a server response after unmount', async () => {
    let resolve!: (v: unknown) => void;
    vi.mocked(api.get).mockReturnValueOnce(new Promise((r) => (resolve = r)) as never);
    const { result, unmount } = renderHook(() => useTeamRaceLineup(7, 12));
    unmount();
    await act(async () => resolve({ assignments: local, updatedAt: 'x' }));
    expect(result.current.assignments).toEqual({});
    expect(localStorage.getItem(KEY)).toBeNull();

    let reject!: (e: unknown) => void;
    vi.mocked(api.get).mockReturnValueOnce(new Promise((_, r) => (reject = r)) as never);
    const second = renderHook(() => useTeamRaceLineup(7, 12));
    second.unmount();
    await act(async () => reject(new Error('x')));
    expect(second.result.current.assignments).toEqual({});
  });

  it('keeps local data and reports an error when the save fails', async () => {
    vi.mocked(api.get).mockResolvedValue({ assignments: {}, updatedAt: null } as never);
    vi.mocked(api.put).mockRejectedValueOnce(new Error('503'));
    const { result } = renderHook(() => useTeamRaceLineup(7, 12));
    let out;
    await act(async () => {
      out = await result.current.saveAssignments(local);
    });
    expect(out).toEqual(local);
    expect(result.current.error).toBe('503');
    expect(result.current.saving).toBe(false);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(local);

    vi.mocked(api.put).mockRejectedValueOnce(new Error(''));
    await act(async () => {
      await result.current.saveAssignments(local);
    });
    expect(result.current.error).toBe('Saved on this device; could not sync with server.');
  });

  it('returns the submitted plan when the server reply has no assignments', async () => {
    vi.mocked(api.get).mockResolvedValue({ assignments: {}, updatedAt: null } as never);
    vi.mocked(api.put).mockResolvedValueOnce({ data: {} } as never);
    const { result } = renderHook(() => useTeamRaceLineup(7, 12));
    let out;
    await act(async () => {
      out = await result.current.saveAssignments(local);
    });
    expect(out).toEqual(local);
    expect(result.current.assignments).toEqual(local);
  });

  it('skips the server call when api.put is unavailable, and survives storage failures', async () => {
    vi.mocked(api.get).mockResolvedValue({ assignments: {}, updatedAt: null } as never);
    const original = api.put;
    (api as { put?: unknown }).put = undefined;
    try {
      const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota');
      });
      const { result } = renderHook(() => useTeamRaceLineup(7, 12));
      let out;
      await act(async () => {
        out = await result.current.saveAssignments(local);
      });
      expect(out).toEqual(local);
      expect(setItem).toHaveBeenCalled();
      expect(result.current.saving).toBe(false);
    } finally {
      (api as { put?: unknown }).put = original;
    }
  });
});
