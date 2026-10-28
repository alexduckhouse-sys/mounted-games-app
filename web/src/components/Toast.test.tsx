import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MotionConfig } from 'framer-motion';
import { TOAST_ACTION_MS, TOAST_MS, useToast, type ToastOptions } from './Toast';

let play: (message: string, options?: ToastOptions) => void = () => {};
const keep = (show: (message: string, options?: ToastOptions) => void) => { play = show; };
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

it('can carry an action such as Undo: it stays longer, runs once and puts the toast away', () => {
  const undo = vi.fn();
  render(<MotionConfig reducedMotion="always"><Harness /></MotionConfig>);
  act(() => play('Unfollowed', { action: { label: 'Undo', onClick: undo } }));
  act(() => { vi.advanceTimersByTime(TOAST_MS + 100); });
  const button = screen.getByRole('button', { name: 'Undo' });
  expect(screen.getByRole('status')).toHaveTextContent('Unfollowed');
  act(() => { button.click(); });
  expect(undo).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('status')).toBeNull();
});

it('lets an action toast time out untouched, and has no button when there is no action', () => {
  const undo = vi.fn();
  render(<MotionConfig reducedMotion="always"><Harness /></MotionConfig>);
  act(() => play('Unfollowed', { action: { label: 'Undo', onClick: undo } }));
  act(() => { vi.advanceTimersByTime(TOAST_ACTION_MS); });
  expect(screen.queryByRole('status')).toBeNull();
  expect(undo).not.toHaveBeenCalled();
  act(() => play('Saved'));
  expect(screen.queryByRole('button')).toBeNull();
});

it('marks a failure with a "!" instead of the tick', () => {
  render(<MotionConfig reducedMotion="always"><Harness /></MotionConfig>);
  act(() => play('Couldn’t do that', { error: true }));
  expect(screen.getByRole('status').querySelector('svg')).toHaveAttribute('data-tone', 'error');
});
