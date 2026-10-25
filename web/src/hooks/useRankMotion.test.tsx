import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MotionConfig } from 'framer-motion';
import { playRankMoves, useRankMotion } from './useRankMotion';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

function list(ids: number[]) {
  const ol = document.createElement('ol');
  for (const id of ids) {
    const li = document.createElement('li');
    li.dataset.rankId = String(id);
    li.innerHTML = '<span data-grow="start">Team</span><span data-grow="end">10</span>';
    ol.appendChild(li);
  }
  document.body.appendChild(ol);
  return ol;
}
const rowOf = (root: Element, id: number) => root.querySelector(`[data-rank-id="${id}"]`)!;

describe('playRankMoves', () => {
  it('lifts climbers, trails sparkles on a big climb and throws confetti over the cut-off', () => {
    // Team 4 climbs from fourth to first and team 2 from third to second: both into the top two.
    const ol = list([4, 2, 1, 3]);
    playRankMoves(ol, [1, 3, 2, 4], [4, 2, 1, 3], { cutAfter: 1, delayS: 0.1 });
    expect(rowOf(ol, 4)).not.toHaveClass('mg-rank-lift');
    vi.advanceTimersByTime(100);
    expect(rowOf(ol, 4)).toHaveClass('mg-rank-lift');
    expect(rowOf(ol, 2)).toHaveClass('mg-rank-lift');
    expect(rowOf(ol, 1)).not.toHaveClass('mg-rank-lift');
    vi.advanceTimersByTime(500);
    // Only the big climber sparkles: four sparkles at each of four points along the way.
    expect(document.querySelectorAll('.mg-sparkle')).toHaveLength(16);
    expect(document.querySelectorAll('.mg-confetti')).toHaveLength(60);
    vi.advanceTimersByTime(300);
    expect(rowOf(ol, 4)).not.toHaveClass('mg-rank-lift');
  });

  it('skips rows that are not on screen, and stops cleanly', () => {
    const ol = list([2, 1]);
    const stop = playRankMoves(ol, [1, 2, 9], [9, 2, 1], { cutAfter: 0 });
    stop();
    vi.advanceTimersByTime(2000);
    expect(rowOf(ol, 2)).not.toHaveClass('mg-rank-lift');
    expect(document.querySelectorAll('.mg-confetti')).toHaveLength(0);
  });
});

function Table({ ids, cutAfter = null }: { ids: number[]; cutAfter?: number | null }) {
  const ref = useRankMotion<HTMLOListElement>(ids, cutAfter);
  return <ol ref={ref}>{ids.map((id) => <li key={id} data-rank-id={id}><span data-grow="start">{id}</span></li>)}</ol>;
}

describe('useRankMotion', () => {
  it('plays only when the order changes after the first draw', () => {
    const { container, rerender } = render(<Table ids={[1, 2, 3, 4]} cutAfter={0} />);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(container.querySelector('.mg-rank-lift')).toBeNull();
    rerender(<Table ids={[4, 1, 2, 3]} cutAfter={0} />);
    act(() => { vi.advanceTimersByTime(10); });
    expect(rowOf(container, 4)).toHaveClass('mg-rank-lift');
    act(() => { vi.advanceTimersByTime(500); });
    expect(document.querySelectorAll('.mg-confetti').length).toBeGreaterThan(0);
  });

  it('stays still in lite mode', () => {
    const still = (ids: number[]) => <MotionConfig reducedMotion="always"><Table ids={ids} /></MotionConfig>;
    const { container, rerender } = render(still([1, 2, 3, 4]));
    rerender(still([4, 3, 2, 1]));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(container.querySelector('.mg-rank-lift')).toBeNull();
    expect(document.querySelectorAll('.mg-sparkle')).toHaveLength(0);
  });
});
