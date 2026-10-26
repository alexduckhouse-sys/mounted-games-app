import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MotionConfig } from 'framer-motion';
import { TOAST_MS, useToast } from './Toast';

let play: (message: string) => void = () => {};
const keep = (show: (message: string) => void) => { play = show; };
function Harness() {
  const { show, node } = useToast();
  keep(show);
  return <>{node}</>;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it('is one pill with a tick and the message, for about two seconds', () => {
  render(<MotionConfig reducedMotion="always"><Harness /></MotionConfig>);
  expect(screen.queryByRole('status')).toBeNull();
  act(() => play('Link copied'));
  const toast = screen.getByRole('status');
  expect(toast).toHaveTextContent('Link copied');
  expect(toast).toHaveClass('kit-toast');
  expect(toast.querySelector('svg path')).not.toBeNull();
  act(() => { vi.advanceTimersByTime(TOAST_MS); });
  expect(screen.queryByRole('status')).toBeNull();
});

it('draws the tick when motion is on, and a second toast replaces the first', () => {
  render(<Harness />);
  act(() => play('Reported'));
  act(() => { vi.advanceTimersByTime(TOAST_MS - 100); });
  act(() => play('Sent'));
  expect(screen.getAllByRole('status').at(-1)).toHaveTextContent('Sent');
});
