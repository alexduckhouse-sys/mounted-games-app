import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { useWindSettings } from './useWindSettings';
vi.mock('../api', () => ({ api: { get: vi.fn() } }));
beforeEach(() => { vi.mocked(api.get).mockResolvedValue({ data: { selections: [], acknowledgements: [] } }); });
describe('shared wind settings', () => {
  it('loads settings only for an organiser and refreshes an explicit review', async () => {
    const { result, rerender } = renderHook(({ enabled }) => useWindSettings(7, enabled), { initialProps: { enabled: false } });
    expect(api.get).not.toHaveBeenCalled(); rerender({ enabled: true });
    await waitFor(() => expect(result.current?.id).toBe(7));
    await act(async () => window.dispatchEvent(new Event('mg:wind-review')));
    expect(api.get).toHaveBeenCalledTimes(2);
  });
  it('leaves awareness defaults available if the private rules request fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useWindSettings(7, true));
    await act(async () => Promise.resolve()); expect(result.current).toBeNull();
  });
});
