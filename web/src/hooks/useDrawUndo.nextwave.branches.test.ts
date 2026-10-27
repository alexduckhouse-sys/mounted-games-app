import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { EMPTY_DRAW_UNDO_STATUS } from '../lib/drawUndo';
import { useDrawUndo } from './useDrawUndo';

vi.mock('../api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

const available = { available: true, undoId: 1, kind: 'SectionDraw', label: 'Redraw', affectedHeats: 2, affectedSessions: 1 };

describe('useDrawUndo branches', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
  });

  it('does nothing without a valid competition id', async () => {
    for (const id of [null, undefined, 0, -3]) {
      const { result } = renderHook(() => useDrawUndo(id));
      expect(api.get).not.toHaveBeenCalled();
      let status;
      await act(async () => { status = await result.current.refresh(); });
      expect(status).toBe(EMPTY_DRAW_UNDO_STATUS);
      let undone: unknown = 'x';
      await act(async () => { undone = await result.current.undo(); });
      expect(undone).toBeNull();
      expect(api.post).not.toHaveBeenCalled();
    }
  });

  it('does not auto-load when autoLoad is false, but refresh loads on demand (bare payload, no data wrapper)', async () => {
    vi.mocked(api.get).mockResolvedValue(available as never);
    const { result } = renderHook(() => useDrawUndo(5, false));
    expect(api.get).not.toHaveBeenCalled();
    await act(async () => { await result.current.refresh(); });
    expect(api.get).toHaveBeenCalledWith('/competitions/5/draw-undo');
    expect(result.current.undoStatus.label).toBe('Redraw');
    expect(result.current.loading).toBe(false);
  });

  it('refresh reports an error message, falling back to a default when the error has none', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Offline'));
    const { result } = renderHook(() => useDrawUndo(5, false));
    let status;
    await act(async () => { status = await result.current.refresh(); });
    expect(status).toBe(EMPTY_DRAW_UNDO_STATUS);
    expect(result.current.error).toBe('Offline');

    vi.mocked(api.get).mockRejectedValueOnce(new Error(''));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.error).toBe('Could not check undo status.');
  });

  it('auto-load failure sets an error, with a default message for empty or non-error rejections', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Nope'));
    const first = renderHook(() => useDrawUndo(5));
    await waitFor(() => expect(first.result.current.error).toBe('Nope'));

    vi.mocked(api.get).mockRejectedValueOnce(undefined);
    const second = renderHook(() => useDrawUndo(6));
    await waitFor(() => expect(second.result.current.error).toBe('Could not check undo status.'));
  });

  it('auto-load accepts a bare payload without a data wrapper', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(available as never);
    const { result } = renderHook(() => useDrawUndo(5));
    await waitFor(() => expect(result.current.undoStatus.undoId).toBe(1));
  });

  it('ignores an auto-load result that arrives after unmount', async () => {
    let resolve!: (v: unknown) => void;
    vi.mocked(api.get).mockReturnValueOnce(new Promise((r) => { resolve = r; }) as never);
    const { result, unmount } = renderHook(() => useDrawUndo(5));
    unmount();
    await act(async () => { resolve({ data: available }); });
    expect(result.current.undoStatus).toBe(EMPTY_DRAW_UNDO_STATUS);

    let reject!: (e: unknown) => void;
    vi.mocked(api.get).mockReturnValueOnce(new Promise((_, r) => { reject = r; }) as never);
    const second = renderHook(() => useDrawUndo(5));
    second.unmount();
    await act(async () => { reject(new Error('late')); });
    expect(second.result.current.error).toBeNull();
  });

  it('undo falls back to refreshing when the response is not a restore', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: available } as never);
    vi.mocked(api.post).mockResolvedValueOnce({ restored: false } as never);
    const { result } = renderHook(() => useDrawUndo(5, false));
    let out: unknown = 'x';
    await act(async () => { out = await result.current.undo(); });
    expect(out).toBeNull();
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(result.current.undoStatus.available).toBe(true);
    expect(result.current.restoring).toBe(false);
  });

  it('undo uses a bare payload and stores the returned status', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ restored: true, undoStatus: available } as never);
    const { result } = renderHook(() => useDrawUndo(5, false));
    await act(async () => { await result.current.undo(); });
    expect(result.current.undoStatus.undoId).toBe(1);
  });

  it('undo records the error and rethrows, with a default message when empty', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('Expired'));
    const { result } = renderHook(() => useDrawUndo(5, false));
    await act(async () => { await expect(result.current.undo()).rejects.toThrow('Expired'); });
    expect(result.current.error).toBe('Expired');

    vi.mocked(api.post).mockRejectedValueOnce(new Error(''));
    await act(async () => { await expect(result.current.undo()).rejects.toThrow(); });
    expect(result.current.error).toBe('Could not undo the last change.');
    expect(result.current.restoring).toBe(false);
  });
});
