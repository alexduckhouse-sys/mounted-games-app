import { describe, expect, it } from 'vitest';
import { heat, race, result, session } from '../test/factories';
import { computeTeamStats } from './teamStats';

const raceName = (n: number) => `Race ${n}`;
const heatName = (n: number) => `Heat ${n}`;
const entries = [1, 2, 3].map((id) => ({ id, teamId: id, teamName: `Team ${id}`, laneIndex: id }));
const scored = (id: number, name: string, results: ReturnType<typeof result>[], extra = {}) => race(id, { name, isComplete: true, results, ...extra });

describe('computeTeamStats', () => {
  const sessions = [
    session(1, { heats: [
      heat(1, { entries, races: [
        scored(1, 'Mug Shuffle', [result(1, 1, { points: 3 }), result(2, 2, { points: 2 }), result(3, 3, { points: 1 })]),
        scored(2, 'Two Flag', [result(1, 3, { points: 1 }), result(2, 1, { points: 3 }), result(3, 2, { points: 2 })]),
        race(3, { name: 'Unscored' }),
      ] }),
      heat(2, { label: 'Heat B', entries, races: [
        scored(4, 'Mug Shuffle', [result(1, 2, { points: 2 }), result(2, 1, { points: 3 }), result(3, 3, { points: 1 })]),
      ] }),
    ] }),
    session(2, { name: 'Seniors finals', heats: [heat(3, { label: 'A Final', raceRoundStage: 2, entries, races: [
      scored(5, 'Mug Shuffle', [result(1, 1, { points: 3 }), result(2, 2, { points: 2 })]),
    ] })] }),
  ];

  it('adds up the races scored: averages, wins and the point quota', () => {
    const stats = computeTeamStats(sessions, 1, raceName, heatName)!;
    expect(stats.scoredRaces).toBe(4);
    expect(stats.totalPoints).toBe(9);
    expect(stats.avgPointsPerRace).toBeCloseTo(2.25);
    expect(stats.avgPlace).toBeCloseTo(7 / 4);
    expect(stats.racesWon).toBe(2);
    // 9 of 3 + 3 + 3 + 3 on offer.
    expect(stats.pointQuota).toBe(75);
  });

  it('groups the runs by race, in the order each race first came up, with where each was ridden', () => {
    const stats = computeTeamStats(sessions, 1, raceName, heatName)!;
    expect(stats.races.map((item) => item.name)).toEqual(['Mug Shuffle', 'Two Flag']);
    const mug = stats.races[0];
    expect(mug.runs.map((run) => run.where)).toEqual(['Heat 1', 'Heat B', 'A Final']);
    expect(mug.runs.map((run) => run.isFinal)).toEqual([false, false, true]);
    expect(mug.runs.map((run) => run.points)).toEqual([3, 2, 3]);
    expect(mug).toMatchObject({ totalPoints: 8, bestPlace: 1 });
    expect(mug.average).toBeCloseTo(8 / 3);
    expect(stats.races[1]).toMatchObject({ totalPoints: 1, bestPlace: 3 });
  });

  it('names the best and hardest race by average points per run', () => {
    const stats = computeTeamStats(sessions, 1, raceName, heatName)!;
    expect(stats.best?.name).toBe('Mug Shuffle');
    expect(stats.hardest?.name).toBe('Two Flag');
  });

  it('has no best or hardest race with only one race to compare', () => {
    const one = computeTeamStats([session(1, { heats: [heat(1, { entries, races: [scored(1, 'Mug Shuffle', [result(1, 1, { points: 3 })])] })] })], 1, raceName, heatName)!;
    expect(one.best).toBeNull();
    expect(one.hardest).toBeNull();
  });

  it('is null when nothing has been scored for the team', () => {
    expect(computeTeamStats(sessions, 9, raceName, heatName)).toBeNull();
    expect(computeTeamStats([], 1, raceName, heatName)).toBeNull();
    expect(computeTeamStats([session(1, { heats: [heat(1, { entries, races: [race(1)] })] })], 1, raceName, heatName)).toBeNull();
  });

  it('leaves out sit-outs and break sessions, and counts a team put out as a run with no place', () => {
    const odd = [
      session(1, { kind: 1, heats: [heat(1, { entries, races: [scored(1, 'Break', [result(1, 1, { points: 9 })])] })] }),
      session(2, { heats: [heat(2, { entries, races: [
        scored(2, 'Mug Shuffle', [result(1, null, { points: 0, isSitOut: true })]),
        scored(3, '', [result(1, null, { points: 0, eliminated: true, status: 3 }), result(2, 1, { points: 3 })], { orderIndex: 2 }),
      ] })] }),
    ];
    const stats = computeTeamStats(odd, 1, raceName, heatName)!;
    expect(stats.scoredRaces).toBe(1);
    expect(stats.avgPlace).toBeNull();
    expect(stats.racesWon).toBe(0);
    expect(stats.races).toHaveLength(1);
    // A race with no name of its own gets the caller's words, from its position.
    expect(stats.races[0].name).toBe('Race 3');
    expect(stats.races[0].runs[0]).toMatchObject({ eliminated: true, placing: null, status: 3, points: 0 });
    expect(stats.races[0].bestPlace).toBeNull();
  });

  it('counts a qualifier round as one point on offer, and sorts sessions and heats into running order', () => {
    const rounds = [
      session(2, { orderIndex: 2, heats: [heat(2, { orderIndex: 1, raceRoundStage: 1, entries, races: [scored(2, 'Mug Shuffle', [result(1, 1, { points: 1 })])] })] }),
      session(1, { orderIndex: 1, heats: [
        heat(4, { orderIndex: 2, entries, races: [scored(4, 'Two Flag', [result(1, 2, { points: 2 })])] }),
        heat(3, { orderIndex: 1, entries, races: [scored(3, 'Mug Shuffle', [result(1, 3, { points: 1 })])] }),
      ] }),
    ];
    const stats = computeTeamStats(rounds, 1, raceName, heatName)!;
    expect(stats.races.map((item) => item.name)).toEqual(['Mug Shuffle', 'Two Flag']);
    expect(stats.races[0].runs.map((run) => run.where)).toEqual(['Heat 1', 'Heat 1']);
    // 4 of 3 + 3 + 1.
    expect(stats.pointQuota).toBe(Math.round((4 / 7) * 100));
  });
});
