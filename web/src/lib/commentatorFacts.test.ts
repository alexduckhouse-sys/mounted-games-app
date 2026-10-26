import { describe, expect, it } from 'vitest';
import { race, result } from '../test/factories';
import { commentatorFacts, winStreak } from './commentatorFacts';

const won = (id: number, order: number, winner: number) => race(id, {
  orderIndex: order, isComplete: true, results: [result(winner, 1, { points: 3 }), result(winner === 1 ? 2 : 1, 2, { points: 2 })],
});

describe('winStreak', () => {
  it('counts the latest scored races a team won in a row', () => {
    const races = [won(1, 1, 2), won(2, 2, 1), won(3, 3, 1), race(4, { orderIndex: 4 })];
    expect(winStreak(races, 1)).toBe(2);
    expect(winStreak(races, 2)).toBe(0);
  });

  it('stops at a race the team did not win, was eliminated in, or missed', () => {
    const out = race(5, { orderIndex: 5, isComplete: true, results: [result(1, null, { eliminated: true })] });
    expect(winStreak([won(1, 1, 1), out], 1)).toBe(0);
    expect(winStreak([won(1, 1, 1), race(6, { orderIndex: 6, isComplete: true, results: [] })], 1)).toBe(0);
  });
});

describe('commentatorFacts', () => {
  const standings = [
    { teamId: 1, totalPoints: 12, racesRun: 3 },
    { teamId: 2, totalPoints: 11, racesRun: 3 },
    { teamId: 3, totalPoints: 9, racesRun: 3 },
    { teamId: 4, totalPoints: 12, racesRun: 3 },
  ];

  it('says who is leading, who is behind and by how much, and any winning streak', () => {
    const facts = commentatorFacts([1, 2, 3], [won(1, 1, 1), won(2, 2, 1)], standings);
    expect(facts[1]).toBe('Won the last 2 races · Leading');
    expect(facts[2]).toBe('1 point behind 1st');
    expect(facts[3]).toBe('3 points behind 1st');
  });

  it('mentions a single win, and says nothing for a team level with the leader', () => {
    const facts = commentatorFacts([2, 4], [won(1, 1, 2)], standings);
    expect(facts[2]).toBe('Won the last race · 1 point behind 1st');
    expect(facts[4]).toBeUndefined();
  });

  it('says nothing about standings before a race has been run, or for a team not in them', () => {
    expect(commentatorFacts([1], [], [{ teamId: 1, totalPoints: 0, racesRun: 0 }])).toEqual({});
    expect(commentatorFacts([9], [], standings)).toEqual({});
  });
});
