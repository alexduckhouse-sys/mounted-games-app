import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MotionConfig } from 'framer-motion';
import { SAVED_TICK_MS, useSavedTick } from './SavedTick';

let play: (label: string) => void = () => {};
const keep = (show: (label: string) => void) => { play = show; };

function Harness() {
  const { show, node } = useSavedTick();
  keep(show);
  return <>{node}</>;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it('pops up saying what was saved, then goes', () => {
  render(<MotionConfig reducedMotion="always"><Harness /></MotionConfig>);
  expect(screen.queryByRole('status')).toBeNull();
  act(() => play('Bottle Race'));
  expect(screen.getByRole('status')).toHaveTextContent('Bottle Race saved');
  act(() => { vi.advanceTimersByTime(SAVED_TICK_MS); });
  expect(screen.queryByRole('status')).toBeNull();
});

it('a second save restarts the time on screen and shows the newer race', () => {
  const { unmount } = render(<MotionConfig reducedMotion="always"><Harness /></MotionConfig>);
  act(() => play('Bending'));
  act(() => { vi.advanceTimersByTime(SAVED_TICK_MS - 100); });
  act(() => play('Flag Race'));
  act(() => { vi.advanceTimersByTime(200); });
  expect(screen.getByRole('status')).toHaveTextContent('Flag Race saved');
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('draws the tick in when motion is on', () => {
  render(<Harness />);
  act(() => play('Sack Race'));
  expect(document.querySelector('.mg-saved-tick-disc path')).not.toBeNull();
});
