import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePageVisible } from './usePageVisible';

function setVisibility(state: DocumentVisibilityState) {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
}

afterEach(() => { vi.restoreAllMocks(); });

describe('usePageVisible', () => {
  it('follows the tab going into the background and coming back', () => {
    const { result, unmount } = renderHook(() => usePageVisible());
    expect(result.current).toBe(true);
    setVisibility('hidden');
    expect(result.current).toBe(false);
    setVisibility('visible');
    expect(result.current).toBe(true);
    const remove = vi.spyOn(document, 'removeEventListener');
    unmount();
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });
});
