import { describe, expect, it } from 'vitest';
import {
  assignSitOutRiderForRace,
  buildAutoRotatedHeatLineup,
  cycleRiderRaceRole,
  raceLineupKey,
  requiredRidersForFormat,
  riderLineupKey,
  summarizeRiderRideCounts,
  validateHeatLineup,
} from './raceLineupPlanner';

describe('raceLineupPlanner (5-rider & 6-rider Sit-Out Planner)', () => {
  const fiveRiders = [
    { id: 101, fullName: 'Alice Smith', isReserve: false },
    { id: 102, fullName: 'Ben Jones', isReserve: false },
    { id: 103, fullName: 'Chloe Evans', isReserve: false },
    { id: 104, fullName: 'Dan Williams', isReserve: false },
    { id: 105, fullName: 'Ella Hughes', isReserve: false },
  ];

  const races = [
    { id: 201, orderIndex: 1, name: 'Bending' },
    { id: 202, orderIndex: 2, name: '2 Flag' },
    { id: 203, orderIndex: 3, name: 'Mug Race' },
    { id: 204, orderIndex: 4, name: 'Bottle' },
    { id: 205, orderIndex: 5, name: 'Sock & Bucket' },
  ];

  it('computes required riders per section format and cycles leg/sit-out roles', () => {
    expect(requiredRidersForFormat(2)).toBe(4);
    expect(requiredRidersForFormat(1)).toBe(2);
    expect(requiredRidersForFormat(3)).toBe(1);

    expect(cycleRiderRaceRole(undefined, 4)).toBe('1');
    expect(cycleRiderRaceRole('1', 4)).toBe('2');
    expect(cycleRiderRaceRole('4', 4)).toBe('sit-out');
    expect(cycleRiderRaceRole('sit-out', 4)).toBe('1');
  });

  it('auto-rotates sit-out assignments across 5 races so every rider rides 4 and sits out 1', () => {
    const plan = buildAutoRotatedHeatLineup(10, races, fiveRiders, 4);
    const summary = summarizeRiderRideCounts(10, races, fiveRiders, plan);

    for (const riderSummary of summary) {
      expect(riderSummary.ridesCount).toBe(4);
      expect(riderSummary.sitOutsCount).toBe(1);
    }
    expect(validateHeatLineup(10, races, fiveRiders, plan, 4)).toEqual([]);
  });

  it('warns when fewer than 4 riders are assigned to a race or when a rider sits out too many times', () => {
    const plan = buildAutoRotatedHeatLineup(10, races, fiveRiders, 4);
    // Make Ella sit out Race 1, Race 2, Race 3
    plan[raceLineupKey(10, races[0])] = assignSitOutRiderForRace(fiveRiders, riderLineupKey(fiveRiders[4]), 4);
    plan[raceLineupKey(10, races[1])] = assignSitOutRiderForRace(fiveRiders, riderLineupKey(fiveRiders[4]), 4);
    plan[raceLineupKey(10, races[2])] = assignSitOutRiderForRace(fiveRiders, riderLineupKey(fiveRiders[4]), 4);

    // Also make 2 riders sit out Race 4 so only 3 riders are assigned
    plan[raceLineupKey(10, races[3])][riderLineupKey(fiveRiders[0])] = 'sit-out';
    plan[raceLineupKey(10, races[3])][riderLineupKey(fiveRiders[1])] = 'sit-out';

    const warnings = validateHeatLineup(10, races, fiveRiders, plan, 4);
    expect(warnings.some((w) => w.kind === 'too-few-riders' && w.message.includes('Race 4: Bottle'))).toBe(true);
    expect(warnings.some((w) => w.kind === 'unbalanced-sit-outs' && w.message.includes('Ella Hughes'))).toBe(true);
  });
});
