import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { EMPTY_DRAW_UNDO_STATUS } from '../lib/drawUndo';
import { useDrawUndo } from './useDrawUndo';

vi.mock('../api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

const active = { available: true, undoId: 1, kind: 'DeleteHeat', label: 'Deleted', affectedHeats: 1, affectedSessions: 1 };

describe('useDrawUndo branches', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
  });

  it('does nothing without a valid competition id', async () => {
    const { result } = renderHook(() => useDrawUndo(null));
    expect(api.get).not.toHaveBeenCalled();
    let status;
    await act(async () => {
      status = await result.current.refresh();
    });
    expect(status).toEqual(EMPTY_DRAW_UNDO_STATUS);
    let undone: unknown = 'x';
    await act(async () => {
      undone = await result.current.undo();
    });
    expect(undone).toBeNull();
    expect(api.post).not.toHaveBeenCalled();

    renderHook(() => useDrawUndo(0));
    renderHook(() => useDrawUndo(-3));
    expect(api.get).not.toHaveBeenCalled();
  });

  it('skips the automatic load when autoLoad is false but refresh still fetches', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(active as never); // no `.data` wrapper
    const { result } = renderHook(() => useDrawUndo(5, false));
    expect(api.get).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.refresh();
    });
    expect(api.get).toHaveBeenCalledWith('/competitions/5/draw-undo');
    expect(result.current.undoStatus.available).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it('reports refresh errors with message and fallback text', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useDrawUndo(5, false));
    await act(async () => {
      expect(await result.current.refresh()).toEqual(EMPTY_DRAW_UNDO_STATUS);
    });
    expect(result.current.error).toBe('boom');

    vi.mocked(api.get).mockRejectedValueOnce(new Error(''));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).toBe('Could not check undo status.');
  });

  it('reports auto-load errors', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useDrawUndo(5));
    await waitFor(() => expect(result.current.error).toBe('offline'));

    vi.mocked(api.get).mockRejectedValueOnce({});
    const second = renderHook(() => useDrawUndo(6));
    await waitFor(() => expect(second.result.current.error).toBe('Could not check undo status.'));
  });

  it('ignores an older competition response after switching competitions', async () => {
    let resolve!: (v: unknown) => void;
    vi.mocked(api.get).mockReturnValueOnce(new Promise((r) => (resolve = r)) as never);
    const { result, rerender } = renderHook(({ id }) => useDrawUndo(id), { initialProps: { id: 7 } });
    const current = { ...active, undoId: 2, label: 'Current competition' };
    vi.mocked(api.get).mockResolvedValueOnce({ data: current } as never);
    rerender({ id: 8 });
    await waitFor(() => expect(result.current.undoStatus.undoId).toBe(2));

    await act(async () => resolve({ data: active }));
    expect(result.current.undoStatus).toMatchObject(current);
    expect(result.current.error).toBeNull();
  });

  it('ignores an older competition failure after switching competitions', async () => {
    let reject!: (e: unknown) => void;
    vi.mocked(api.get).mockReturnValueOnce(new Promise((_, r) => (reject = r)) as never);
    const { result, rerender } = renderHook(({ id }) => useDrawUndo(id), { initialProps: { id: 7 } });
    vi.mocked(api.get).mockResolvedValueOnce({ data: active } as never);
    rerender({ id: 8 });
    await waitFor(() => expect(result.current.undoStatus.available).toBe(true));

    await act(async () => reject(new Error('late')));
    expect(result.current.undoStatus).toMatchObject(active);
    expect(result.current.error).toBeNull();
  });

  it('falls back to a refresh when the undo response is not a restore, and surfaces failures', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: active } as never);
    vi.mocked(api.post).mockResolvedValueOnce({ data: { restored: false } } as never);
    const { result } = renderHook(() => useDrawUndo(5, false));
    let res: unknown = 'x';
    await act(async () => {
      res = await result.current.undo();
    });
    expect(res).toBeNull();
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(result.current.undoStatus.available).toBe(true);
    expect(result.current.restoring).toBe(false);

    vi.mocked(api.post).mockRejectedValueOnce(new Error('conflict'));
    await act(async () => {
      await expect(result.current.undo()).rejects.toThrow('conflict');
    });
    expect(result.current.error).toBe('conflict');

    vi.mocked(api.post).mockRejectedValueOnce(new Error(''));
    await act(async () => {
      await expect(result.current.undo()).rejects.toThrow();
    });
    expect(result.current.error).toBe('Could not undo the last change.');
  });
});
