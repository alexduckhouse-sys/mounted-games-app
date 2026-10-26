import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MotionConfig } from 'framer-motion';
import { useSavedToast } from './SavedTick';
import { TOAST_MS } from './Toast';

let toast: (label: string) => void = () => {};
const keep = (show: (label: string) => void) => { toast = show; };
function Harness() {
  const { show, node } = useSavedToast();
  keep(show);
  return <>{node}</>;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it('says what saved and drops away, restarting for each save', () => {
  const { unmount } = render(<MotionConfig reducedMotion="always"><Harness /></MotionConfig>);
  expect(screen.queryByRole('status')).toBeNull();
  act(() => toast('Venue'));
  expect(screen.getByRole('status')).toHaveTextContent('Venue saved');
  act(() => { vi.advanceTimersByTime(TOAST_MS - 100); });
  act(() => toast('Name'));
  act(() => { vi.advanceTimersByTime(200); });
  expect(screen.getByRole('status')).toHaveTextContent('Name saved');
  act(() => { vi.advanceTimersByTime(TOAST_MS); });
  expect(screen.queryByRole('status')).toBeNull();
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
