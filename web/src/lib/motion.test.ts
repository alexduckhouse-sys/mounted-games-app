import { describe, expect, it } from 'vitest';
import { countStep, previousSlots } from './motion';

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
