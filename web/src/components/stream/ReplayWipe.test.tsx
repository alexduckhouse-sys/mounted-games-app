import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { MotionConfig } from 'framer-motion';
import { useReplayWipe, type WipeCard } from './ReplayWipe';

type Wipe = (card: WipeCard, swap: () => void) => void;
let run: Wipe = () => {};
const keep = (wipe: Wipe) => { run = wipe; };

function Harness({ accent }: { accent?: string }) {
  const { wipe, layer } = useReplayWipe(accent, '#102030');
  useEffect(() => keep(wipe), [wipe]);
  return <>{layer}</>;
}

const band = () => document.querySelector<HTMLElement>('.mg-wipe-band');

afterEach(() => { vi.useRealTimers(); });

it('swaps straight away when motion is stilled', () => {
  render(<MotionConfig reducedMotion="always"><Harness /></MotionConfig>);
  const swap = vi.fn();
  act(() => run({ title: 'Replay', detail: 'Arena 1 -15s' }, swap));
  expect(swap).toHaveBeenCalledTimes(1);
  expect(band()).toBeNull();
});

it('sweeps the band over, swaps while covered, then sweeps it away', async () => {
  render(<Harness accent="#FF0000" />);
  const swap = vi.fn();
  act(() => run({ title: 'Replay', detail: 'Arena 1 -15s' }, swap));
  expect(band()).not.toBeNull();
  expect(band()!.style.getPropertyValue('--wipe-accent')).toBe('#FF0000');
  expect(screen.getByText('Replay')).toBeInTheDocument();
  expect(screen.getByText('Arena 1 -15s')).toBeInTheDocument();
  expect(swap).not.toHaveBeenCalled();
  await waitFor(() => expect(swap).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(band()).toBeNull(), { timeout: 2000 });
});

it('draws inside the full-screen element when the player is in full screen', () => {
  const frame = document.createElement('div');
  document.body.appendChild(frame);
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => frame });
  try {
    render(<Harness />);
    act(() => run({ title: 'Replay' }, vi.fn()));
    expect(frame.querySelector('.mg-wipe-band')).not.toBeNull();
  } finally {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null });
    frame.remove();
  }
});

it('marks the way back to live with a dot and no clip name', async () => {
  render(<Harness />);
  act(() => run({ title: 'Live' }, vi.fn()));
  expect(screen.getByText('Live')).toBeInTheDocument();
  expect(document.querySelector('.mg-wipe-dot')).not.toBeNull();
  expect(document.querySelector('.mg-wipe-words small')).toBeNull();
});

it('does the earlier swap at once when a second wipe starts before the band covers', async () => {
  render(<Harness />);
  const first = vi.fn();
  const second = vi.fn();
  act(() => run({ title: 'Replay', detail: 'One' }, first));
  act(() => run({ title: 'Replay', detail: 'Two' }, second));
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).not.toHaveBeenCalled();
  await waitFor(() => expect(second).toHaveBeenCalledTimes(1));
  expect(first).toHaveBeenCalledTimes(1);
});

it('still swaps if the sweep never reports back, and cleans up on unmount', () => {
  vi.useFakeTimers();
  const { unmount } = render(<Harness />);
  const swap = vi.fn();
  act(() => run({ title: 'Replay' }, swap));
  act(() => { vi.advanceTimersByTime(800); });
  expect(swap).toHaveBeenCalledTimes(1);
  // A wipe still holding when the player closes leaves no timers behind.
  act(() => run({ title: 'Live' }, vi.fn()));
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
