import { act, render, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HeatRing } from './HeatRing';

const now = new Date('2026-10-26T10:00:00Z');
const inMinutes = (m: number) => new Date(now.getTime() + m * 60_000);

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); });

it('counts down the minutes and turns amber close to the heat', () => {
  render(<HeatRing at={inMinutes(6)} live={false} />);
  expect(screen.getByRole('img', { name: 'Starts in 6 minutes' })).toHaveAttribute('data-tone', 'wait');
  expect(screen.getByText('6')).toBeInTheDocument();
  act(() => { vi.advanceTimersByTime(60_000); });
  expect(screen.getByRole('img', { name: 'Starts in 5 minutes' })).toHaveAttribute('data-tone', 'soon');
});

it('says when the heat is due or on', () => {
  const { rerender } = render(<HeatRing at={inMinutes(-1)} live={false} />);
  expect(screen.getByRole('img', { name: 'Due now' })).toHaveTextContent('Due');
  rerender(<HeatRing at={inMinutes(-1)} live />);
  expect(screen.getByRole('img', { name: 'On now' })).toHaveAttribute('data-tone', 'live');
});

it('shows the fallback more than an hour out, and stands still when motion is stilled', () => {
  const { rerender } = render(<HeatRing at={inMinutes(90)} live={false} fallback={<span>dot</span>} />);
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByText('dot')).toBeInTheDocument();
  rerender(<HeatRing at={null} live={false} />);
  expect(screen.queryByRole('img')).toBeNull();
  rerender(<MotionConfig reducedMotion="always"><HeatRing at={inMinutes(30)} live={false} /></MotionConfig>);
  expect(screen.getByRole('img', { name: 'Starts in 30 minutes' })).toBeInTheDocument();
});
