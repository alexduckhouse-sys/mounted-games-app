import { describe, expect, it } from 'vitest';
import type { FilmingOptOut } from '../types';
import { describeOptOut, upcomingOptOuts } from './filming';

const optOut = (extra: Partial<FilmingOptOut>): FilmingOptOut => ({
  heatId: 1, sessionId: 1, sessionName: 'Session A', arenaName: null, heatLabel: 'Heat 1', teamId: 1, teamName: 'Team 1',
  lane: 1, riderName: 'Oliver Smith', isReserve: false, heatFinished: false, sessionOrder: 1, heatOrder: 1, ...extra,
});

describe('describeOptOut', () => {
  it('names the heat, lane and rider', () => {
    expect(describeOptOut(optOut({ heatLabel: 'Heat 2', lane: 4 }))).toBe('Filming opt-out: Heat 2, lane 4 (Oliver Smith)');
  });
});

describe('upcomingOptOuts', () => {
  it('skips finished heats and keeps the first two open heats of each session', () => {
    const all = [
      optOut({ heatId: 1, heatOrder: 1, heatFinished: true }),
      optOut({ heatId: 2, heatOrder: 2 }),
      optOut({ heatId: 3, heatOrder: 3, lane: 5 }),
      optOut({ heatId: 3, heatOrder: 3, lane: 2, riderName: 'Ava Bell' }),
      optOut({ heatId: 4, heatOrder: 4 }),
      optOut({ heatId: 9, sessionId: 2, sessionOrder: 2, heatOrder: 1 }),
    ];
    const result = upcomingOptOuts(all);
    expect(result.map((o) => [o.heatId, o.lane])).toEqual([[2, 1], [3, 2], [3, 5], [9, 1]]);
  });

  it('covers as many heats as asked for, and nothing when there are none', () => {
    const all = [optOut({ heatId: 2, heatOrder: 2 }), optOut({ heatId: 3, heatOrder: 3 })];
    expect(upcomingOptOuts(all, 1).map((o) => o.heatId)).toEqual([2]);
    expect(upcomingOptOuts([])).toEqual([]);
  });

  it('orders ties by rider name', () => {
    const result = upcomingOptOuts([optOut({ riderName: 'Zed' }), optOut({ riderName: 'Abe' })]);
    expect(result.map((o) => o.riderName)).toEqual(['Abe', 'Zed']);
  });
});
