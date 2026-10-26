import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { useDrawUndo } from './useDrawUndo';

vi.mock('../api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

describe('useDrawUndo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads the current undo status and triggers POST /competitions/:id/draw-undo', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: {
        available: true,
        undoId: 11,
        kind: 'DeleteHeat',
        label: 'Deleted Heat 2 in Session 1',
        affectedHeats: 2,
        affectedSessions: 1,
      },
    } as never);
    vi.mocked(api.post).mockResolvedValueOnce({
      data: {
        restored: true,
        label: 'Deleted Heat 2 in Session 1',
        restoredSessions: 1,
        restoredHeats: 2,
        undoStatus: { available: false },
      },
    } as never);

    const { result } = renderHook(() => useDrawUndo(7));

    await waitFor(() => {
      expect(result.current.undoStatus.available).toBe(true);
    });
    expect(result.current.undoStatus.label).toBe('Deleted Heat 2 in Session 1');

    let undoRes: Awaited<ReturnType<typeof result.current.undo>> = null;
    await act(async () => {
      undoRes = await result.current.undo();
    });

    expect(api.post).toHaveBeenCalledWith('/competitions/7/draw-undo', {});
    expect(undoRes?.restored).toBe(true);
    expect(result.current.undoStatus.available).toBe(false);
  });
});
