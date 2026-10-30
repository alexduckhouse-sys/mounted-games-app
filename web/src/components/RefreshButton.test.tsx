import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MotionConfig } from 'framer-motion';
import { describe, expect, it, vi } from 'vitest';
import { RefreshButton, RefreshTail } from './RefreshButton';
import type { RefreshPhase } from '../hooks/useRefreshFeedback';

const button = (phase: RefreshPhase, tap = vi.fn()) => (
  <MotionConfig reducedMotion="always"><RefreshButton feedback={{ phase, tap }} label="Refresh timetable" /></MotionConfig>
);

describe('RefreshButton', () => {
  it('shows a still arrow at rest and taps through', async () => {
    const tap = vi.fn();
    const { container } = render(button('idle', tap));
    const refresh = screen.getByRole('button', { name: 'Refresh timetable' });
    expect(refresh).toHaveAttribute('data-phase', 'idle');
    expect(refresh).not.toHaveAttribute('aria-busy');
    expect(refresh).toHaveClass('mg-hdr-icon', 'mg-hdr-icon-sub', 'mg-refresh');
    expect(container.querySelector('.lucide-rotate-cw')).not.toHaveClass('mg-refresh-spin');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    await userEvent.click(refresh);
    expect(tap).toHaveBeenCalledTimes(1);
  });

  it('spins and says so while the refresh is under way', () => {
    const { container } = render(button('loading'));
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('.lucide-rotate-cw')).toHaveClass('mg-refresh-spin');
    expect(screen.getByRole('status')).toHaveTextContent('Refreshing…');
  });

  it.each([
    ['updated', 'Updated', '.mg-refresh-ring'],
    ['same', 'Up to date', '.mg-refresh-ring'],
    ['offline', 'No signal', '.lucide-wifi-off'],
    ['failed', 'Couldn’t refresh', 'path[d="M18 6 6 18"]'],
  ] as const)('turns into its %s icon and announces it', (phase, words, mark) => {
    const { container } = render(button(phase));
    expect(container.querySelector(mark)).not.toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(words);
  });

  it('takes another look, such as the Refine top row', () => {
    render(<RefreshButton feedback={{ phase: 'idle', tap: vi.fn() }} label="Refresh" className="rf-ib" />);
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveClass('rf-ib', 'mg-refresh');
  });

  it('swaps the arrow for the tick and back again', async () => {
    const { container, rerender } = render(button('loading'));
    rerender(button('updated'));
    expect(container.querySelector('path[d="M20 6 9 17l-5-5"]')).not.toBeNull();
    rerender(button('idle'));
    await waitFor(() => expect(container.querySelector('path[d="M20 6 9 17l-5-5"]')).toBeNull());
    expect(container.querySelector('.lucide-rotate-cw')).not.toBeNull();
  });
});

describe('RefreshTail', () => {
  const tail = (phase: RefreshPhase, text?: string) => <MotionConfig reducedMotion="always"><RefreshTail phase={phase} tail={text} /></MotionConfig>;

  it('shows the page’s own tail at rest, and nothing without one', async () => {
    const { container, rerender } = render(tail('idle', '10:54'));
    expect(container).toHaveTextContent('· 10:54');
    expect(container.querySelector('.mg-refresh-status')).toBeNull();
    rerender(tail('idle'));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('shows what the refresh is doing in its place, then the tail again', async () => {
    const { container, rerender } = render(tail('idle', '10:54'));
    rerender(tail('loading', '10:54'));
    await waitFor(() => expect(container).toHaveTextContent('· Refreshing…'));
    expect(container.querySelector('.mg-refresh-status')).toHaveAttribute('data-phase', 'loading');
    rerender(tail('same', '10:55'));
    await waitFor(() => expect(container).toHaveTextContent('· Up to date'));
    rerender(tail('idle', '10:55'));
    await waitFor(() => expect(container).toHaveTextContent('· 10:55'));
  });

  it('shows the status even on a page with no tail', () => {
    const { container } = render(tail('failed'));
    expect(container).toHaveTextContent('· Couldn’t refresh');
  });
});
