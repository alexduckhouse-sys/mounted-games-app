import { describe, expect, it } from 'vitest';
import { climbScale, countStep, previousSlots, rankMoves } from './motion';

describe('previousSlots', () => {
  it('ranks rows on their total before the race just scored', () => {
    const slots = previousSlots([
      { teamId: 1, teamName: 'Oak', total: 15, added: 6 },
      { teamId: 2, teamName: 'Ash', total: 14, added: 0 },
      { teamId: 3, teamName: 'Elm', total: 9, added: 4 },
    ]);
    // Before: Ash 14, Oak 9, Elm 5.
    expect([...slots]).toEqual([[2, 0], [1, 1], [3, 2]]);
  });

  it('breaks ties on name, as the card does', () => {
    const slots = previousSlots([
      { teamId: 1, teamName: 'Cedar', total: 6, added: 2 },
      { teamId: 2, teamName: 'Birch', total: 4, added: 0 },
    ]);
    expect(slots.get(2)).toBe(0);
    expect(slots.get(1)).toBe(1);
  });
});

describe('countStep', () => {
  it('moves in half points and lands exactly on the new total', () => {
    expect(countStep(4, 10, 0)).toBe(4);
    expect(countStep(4, 10, -1)).toBe(4);
    expect(countStep(4, 10, 0.5)).toBe(7);
    expect(countStep(0, 1, 0.3)).toBe(0.5);
    expect(countStep(4, 10.5, 1)).toBe(10.5);
    expect(countStep(4, 10.5, 2)).toBe(10.5);
  });
});

describe('climbScale', () => {
  it('grows more for a bigger climb, up to five places, and never for a drop', () => {
    expect(climbScale(-2)).toBe(1);
    expect(climbScale(0)).toBe(1);
    expect(climbScale(1)).toBeCloseTo(1.05);
    expect(climbScale(3)).toBeCloseTo(1.15);
    expect(climbScale(9)).toBeCloseTo(1.25);
  });
});

describe('rankMoves', () => {
  it('measures each climb and spots teams crossing into the qualifying places', () => {
    // Top two qualify (cutAfter = index 1). Team 3 climbs from third to first.
    expect(rankMoves([1, 2, 3, 4], [3, 1, 2, 4], 1)).toEqual([
      { id: 3, climb: 2, crossedIn: true },
      { id: 1, climb: -1, crossedIn: false },
      { id: 2, climb: -1, crossedIn: false },
      { id: 4, climb: 0, crossedIn: false },
    ]);
  });

  it('leaves out teams that were not in the list before, and never crosses without a cut', () => {
    expect(rankMoves([1, 2], [3, 2, 1])).toEqual([
      { id: 2, climb: 0, crossedIn: false },
      { id: 1, climb: -2, crossedIn: false },
    ]);
  });
});
