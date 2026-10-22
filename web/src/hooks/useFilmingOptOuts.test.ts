import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { useFilmingOptOuts } from './useFilmingOptOuts';

vi.mock('../api', () => ({ api: { get: vi.fn() } }));

describe('useFilmingOptOuts', () => {
  it('loads the opt-outs for the competition', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [{ heatId: 1 }] });
    const { result } = renderHook(() => useFilmingOptOuts(7));
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(api.get).toHaveBeenCalledWith('/competitions/7/filming-optouts', expect.anything());
  });

  it('falls back to an empty list on an error or an answer that is not a list', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('403'));
    const failed = renderHook(() => useFilmingOptOuts(7));
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(failed.result.current).toEqual([]);

    vi.mocked(api.get).mockResolvedValue({ data: '<!doctype html>' });
    const html = renderHook(() => useFilmingOptOuts(8));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(html.result.current).toEqual([]);
  });

  it('reloads when the refresh key changes', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    const { rerender } = renderHook(({ key }) => useFilmingOptOuts(7, key), { initialProps: { key: 1 } });
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    rerender({ key: 2 });
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });
});
