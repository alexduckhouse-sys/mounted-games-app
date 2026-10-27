import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCompetitionPrefetch } from './useCompetitionPrefetch';

describe('useCompetitionPrefetch', () => {
  it('warms a competition once across onPointerDown and onMouseEnter', () => {
    const spy = vi.fn();
    const { result } = renderHook(() => useCompetitionPrefetch(spy));

    const handlers = result.current.handlersFor(19);
    handlers.onPointerDown();
    handlers.onMouseEnter();
    result.current.warm(19);
    result.current.warm(23);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, 19);
    expect(spy).toHaveBeenNthCalledWith(2, 23);
  });
});
