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

const rider = (id: number, extra: Record<string, unknown> = {}) => ({ id, fullName: ` Rider ${id} `, isReserve: false, ...extra });
const race = (id: number, orderIndex: number, name = `R${orderIndex}`) => ({ id, orderIndex, name });

describe('keys and formats', () => {
  it('keys riders by id, falling back to a trimmed name', () => {
    expect(riderLineupKey({ id: 5, fullName: 'A' })).toBe('5');
    expect(riderLineupKey({ id: 0, fullName: '  Zed ' })).toBe('Zed');
  });

  it('keys races by id, falling back to heat and order', () => {
    expect(raceLineupKey(3, { id: 9, orderIndex: 1 })).toBe('9');
    expect(raceLineupKey(3, { id: 0, orderIndex: 2 })).toBe('3:2');
  });

  it('knows how many riders each format needs', () => {
    expect(requiredRidersForFormat(1)).toBe(2);
    expect(requiredRidersForFormat(3)).toBe(1);
    expect(requiredRidersForFormat(2)).toBe(4);
    expect(requiredRidersForFormat(null)).toBe(4);
    expect(requiredRidersForFormat(undefined)).toBe(4);
  });
});

describe('cycleRiderRaceRole', () => {
  it('cycles teams, pairs and individuals, treating unknown as sit-out', () => {
    expect(cycleRiderRaceRole('4')).toBe('sit-out');
    expect(cycleRiderRaceRole('sit-out')).toBe('1');
    expect(cycleRiderRaceRole(undefined)).toBe('1');
    expect(cycleRiderRaceRole('2', 2)).toBe('sit-out');
    expect(cycleRiderRaceRole('1', 2)).toBe('2');
    expect(cycleRiderRaceRole('1', 1)).toBe('sit-out');
    expect(cycleRiderRaceRole('sit-out', 1)).toBe('1');
    expect(cycleRiderRaceRole('nonsense', 1)).toBe('1');
  });
});

describe('assignSitOutRiderForRace', () => {
  it('gives legs in order and keeps reserves out when enough core riders remain', () => {
    const riders = [rider(1), rider(2), rider(3), rider(4), rider(5), rider(6, { isReserve: true })];
    expect(assignSitOutRiderForRace(riders, '5')).toEqual({ '1': '1', '2': '2', '3': '3', '4': '4', '5': 'sit-out', '6': 'sit-out' });
  });

  it('uses reserves when core riders are short, and stops after the last leg', () => {
    const riders = [rider(1), rider(2, { isReserve: true }), rider(3), rider(4), rider(5)];
    expect(assignSitOutRiderForRace(riders, '1')).toEqual({ '1': 'sit-out', '2': '1', '3': '2', '4': '3', '5': '4' });
    expect(assignSitOutRiderForRace(riders, 'none', 2)).toEqual({ '1': '1', '2': 'sit-out', '3': '2', '4': 'sit-out', '5': 'sit-out' });
  });
});

describe('buildAutoRotatedHeatLineup', () => {
  it('returns nothing without riders or races', () => {
    expect(buildAutoRotatedHeatLineup(1, [], [rider(1)])).toEqual({});
    expect(buildAutoRotatedHeatLineup(1, [race(1, 1)], [])).toEqual({});
  });

  it('assigns everyone when the pool fits, benching reserves', () => {
    const riders = [rider(1), rider(2), rider(3), rider(4), rider(5, { isReserve: true })];
    const plan = buildAutoRotatedHeatLineup(1, [race(10, 1)], riders);
    expect(plan['10']).toEqual({ '1': '1', '2': '2', '3': '3', '4': '4', '5': 'sit-out' });
  });

  it('lets reserves ride when there are too few core riders overall', () => {
    const riders = [rider(1), rider(2, { isReserve: true }), rider(3, { isReserve: true })];
    const plan = buildAutoRotatedHeatLineup(1, [race(10, 1)], riders);
    expect(plan['10']).toEqual({ '1': '1', '2': '2', '3': '3' });
  });

  it('caps at the required riders in a small pool', () => {
    const plan = buildAutoRotatedHeatLineup(1, [race(10, 1)], [rider(1), rider(2), rider(3)], 2);
    expect(plan['10']).toEqual({ '1': '1', '2': '2', '3': 'sit-out' });
    const small = buildAutoRotatedHeatLineup(1, [race(10, 1)], [rider(1), rider(2)], 1);
    expect(small['10']).toEqual({ '1': '1', '2': 'sit-out' });
  });

  it('rotates who sits out across races, using heat keys for unsaved races', () => {
    const riders = [rider(1), rider(2), rider(3), rider(4), rider(5)];
    const plan = buildAutoRotatedHeatLineup(7, [race(0, 1), race(0, 2), race(0, 3)], riders);
    expect(Object.keys(plan)).toEqual(['7:1', '7:2', '7:3']);
    expect(plan['7:1']['5']).toBe('sit-out');
    expect(plan['7:2']['4']).toBe('sit-out');
    expect(plan['7:3']['3']).toBe('sit-out');
  });
});

describe('summarizeRiderRideCounts', () => {
  it('counts rides and sit-outs, ignoring races with no assignment', () => {
    const riders = [rider(1), rider(2, { isReserve: true })];
    const races = [race(1, 1), race(2, 2), race(3, 3)];
    const summary = summarizeRiderRideCounts(1, races, riders, {
      '1': { '1': '1', '2': 'sit-out' },
      '2': { '1': 'sit-out' },
    });
    expect(summary).toEqual([
      { riderKey: '1', riderName: ' Rider 1 ', isReserve: false, ridesCount: 1, sitOutsCount: 1 },
      { riderKey: '2', riderName: ' Rider 2 ', isReserve: true, ridesCount: 0, sitOutsCount: 1 },
    ]);
  });
});

describe('validateHeatLineup', () => {
  const riders = [rider(1), rider(2), rider(3), rider(4), rider(5)];

  it('is silent without riders or races', () => {
    expect(validateHeatLineup(1, [], riders, {})).toEqual([]);
    expect(validateHeatLineup(1, [race(1, 1)], [], {})).toEqual([]);
  });

  it('skips races with no plan at all', () => {
    expect(validateHeatLineup(1, [race(1, 1), race(2, 2)], riders, { '2': {} })).toEqual([]);
  });

  it('flags too few and too many riders, labelling by order or position', () => {
    const warnings = validateHeatLineup(1, [race(1, 0, 'Flag'), race(2, 2, 'Bend')], riders, {
      '1': { '1': '1', '2': '2', '3': 'sit-out' },
      '2': { '1': '1', '2': '2', '3': '3', '4': '4', '5': '1' },
    });
    expect(warnings.map((w) => w.kind)).toEqual(['too-few-riders', 'too-many-riders']);
    expect(warnings[0].message).toBe('Race 1: Flag has only 2 of 4 riders assigned.');
    expect(warnings[1].message).toBe('Race 2: Bend has 5 riders assigned (maximum 4).');
  });

  it('allows a short squad to field all its riders', () => {
    expect(validateHeatLineup(1, [race(1, 1)], [rider(1), rider(2)], { '1': { '1': '1', '2': '2' } })).toEqual([]);
  });

  it('flags a core rider who sits out two or more races more than a teammate', () => {
    const races = [race(1, 1), race(2, 2), race(3, 3)];
    const plan = Object.fromEntries(
      races.map((r) => [String(r.id), { '1': 'sit-out', '2': '1', '3': '2', '4': '3', '5': '4' }]),
    );
    const warnings = validateHeatLineup(1, races, riders, plan);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ kind: 'unbalanced-sit-outs', riderKey: '1' });
    expect(warnings[0].message).toContain('sits out 3 races while another rider sits out 0');
  });

  it('does not check balance for squads of four or fewer, or for evenly rotated ones', () => {
    const races = [race(1, 1), race(2, 2)];
    const even = {
      '1': { '1': 'sit-out', '2': '1', '3': '2', '4': '3', '5': '4' },
      '2': { '1': '1', '2': 'sit-out', '3': '2', '4': '3', '5': '4' },
    };
    expect(validateHeatLineup(1, races, riders, even)).toEqual([]);
    const four = [rider(1), rider(2), rider(3), rider(4)];
    const plan = {
      '1': { '1': 'sit-out', '2': '1', '3': '2', '4': '3' },
      '2': { '1': 'sit-out', '2': '1', '3': '2', '4': '3' },
    };
    // Only the "too few riders" warnings fire; there is no sit-out balance check for four riders.
    expect(validateHeatLineup(1, races, four, plan).map((w) => w.kind)).toEqual(['too-few-riders', 'too-few-riders']);
  });
});
