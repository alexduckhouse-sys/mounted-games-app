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

const rider = (id: number, name: string, isReserve = false) => ({ id, fullName: name, isReserve });
const race = (id: number, orderIndex: number, name = `R${orderIndex}`) => ({ id, orderIndex, name });

describe('raceLineupPlanner branches', () => {
  it('builds keys from ids, falling back to name or heat and order', () => {
    expect(riderLineupKey(rider(5, 'A B'))).toBe('5');
    expect(riderLineupKey(rider(0, '  New Rider '))).toBe('New Rider');
    expect(raceLineupKey(9, race(7, 1))).toBe('7');
    expect(raceLineupKey(9, race(0, 3))).toBe('9:3');
    expect(requiredRidersForFormat(null)).toBe(4);
    expect(requiredRidersForFormat(undefined)).toBe(4);
  });

  it('cycles roles for pairs and individuals, and treats unknown roles like sit-out', () => {
    expect(cycleRiderRaceRole('1', 2)).toBe('2');
    expect(cycleRiderRaceRole('2', 2)).toBe('sit-out');
    expect(cycleRiderRaceRole('sit-out', 2)).toBe('1');
    expect(cycleRiderRaceRole('1', 1)).toBe('sit-out');
    expect(cycleRiderRaceRole(undefined, 1)).toBe('1');
    expect(cycleRiderRaceRole('bogus', 4)).toBe('1');
    expect(cycleRiderRaceRole(undefined)).toBe('1');
  });

  it('assigns legs in order and keeps reserves out only when enough core riders remain', () => {
    const five = [rider(1, 'a'), rider(2, 'b'), rider(3, 'c'), rider(4, 'd'), rider(5, 'e', true)];
    // 4 core riders, one sits out: only 3 available non-reserves, so the reserve comes in
    expect(assignSitOutRiderForRace(five, '2', 4)).toEqual({ '1': '1', '2': 'sit-out', '3': '2', '4': '3', '5': '4' });
    // sitting out the reserve: 4 core riders ride
    expect(assignSitOutRiderForRace(five, '5', 4)).toEqual({ '1': '1', '2': '2', '3': '3', '4': '4', '5': 'sit-out' });
    // 6 riders, one reserve: reserve stays out when 4 core remain after the sit-out
    const six = [rider(1, 'a'), rider(2, 'b'), rider(3, 'c'), rider(4, 'd'), rider(5, 'e'), rider(6, 'f', true)];
    expect(assignSitOutRiderForRace(six, '5', 4)).toEqual({ '1': '1', '2': '2', '3': '3', '4': '4', '5': 'sit-out', '6': 'sit-out' });
    // extra riders beyond the required count sit out
    expect(assignSitOutRiderForRace([rider(1, 'a'), rider(2, 'b'), rider(3, 'c')], '99', 2)).toEqual({ '1': '1', '2': '2', '3': 'sit-out' });
  });

  it('returns nothing to plan without riders or races', () => {
    expect(buildAutoRotatedHeatLineup(1, [], [rider(1, 'a')])).toEqual({});
    expect(buildAutoRotatedHeatLineup(1, [race(1, 1)], [])).toEqual({});
  });

  it('gives everyone a leg when the pool is no bigger than the required count', () => {
    const four = [rider(1, 'a'), rider(2, 'b'), rider(3, 'c'), rider(4, 'd')];
    const plan = buildAutoRotatedHeatLineup(1, [race(10, 1)], four, 4);
    expect(plan['10']).toEqual({ '1': '1', '2': '2', '3': '3', '4': '4' });

    // three core riders + one reserve: pool falls back to everyone (4), reserve rides
    const mixed = [rider(1, 'a'), rider(2, 'b'), rider(3, 'c'), rider(4, 'd', true)];
    expect(buildAutoRotatedHeatLineup(1, [race(10, 1)], mixed, 4)['10']).toEqual({ '1': '1', '2': '2', '3': '3', '4': '4' });

    // five riders in a team of pairs-of-two leaves extras on the bench; core pool (3) > 2 so rotation applies
    const pairs = buildAutoRotatedHeatLineup(1, [race(10, 1), race(11, 2), race(12, 3)], [rider(1, 'a'), rider(2, 'b'), rider(3, 'c')], 2);
    for (const key of ['10', '11', '12']) {
      expect(Object.values(pairs[key]).filter((r) => r !== 'sit-out')).toHaveLength(2);
    }
    // a different rider sits each race
    const sat = ['10', '11', '12'].map((k) => Object.entries(pairs[k]).find(([, r]) => r === 'sit-out')![0]);
    expect(new Set(sat).size).toBe(3);
  });

  it('keeps a reserve on the bench when the core pool is large enough to rotate', () => {
    const squad = [rider(1, 'a'), rider(2, 'b'), rider(3, 'c'), rider(4, 'd'), rider(5, 'e'), rider(6, 'r', true)];
    const plan = buildAutoRotatedHeatLineup(2, [race(0, 1), race(0, 2)], squad, 4);
    expect(Object.keys(plan)).toEqual(['2:1', '2:2']);
    expect(plan['2:1']['6']).toBe('sit-out');
    expect(plan['2:1']['5']).toBe('sit-out');
    expect(plan['2:2']['4']).toBe('sit-out');
  });

  it('counts rides and sit-outs, skipping races with no plan for the rider', () => {
    const riders = [rider(1, 'a'), rider(2, 'b', true)];
    const rs = [race(10, 1), race(11, 2), race(12, 3)];
    const out = summarizeRiderRideCounts(1, rs, riders, { '10': { '1': '1', '2': 'sit-out' }, '11': { '1': 'sit-out' } });
    expect(out).toEqual([
      { riderKey: '1', riderName: 'a', isReserve: false, ridesCount: 1, sitOutsCount: 1 },
      { riderKey: '2', riderName: 'b', isReserve: true, ridesCount: 0, sitOutsCount: 1 },
    ]);
  });

  it('validates: nothing to check, skipped empty plans, too many riders, race label fallback', () => {
    expect(validateHeatLineup(1, [], [rider(1, 'a')], {})).toEqual([]);
    expect(validateHeatLineup(1, [race(1, 1)], [], {})).toEqual([]);

    const riders = [rider(1, 'a'), rider(2, 'b'), rider(3, 'c')];
    const rs = [race(10, 0, 'Bending'), race(11, 2, 'Flag'), race(12, 3, 'Empty')];
    const warnings = validateHeatLineup(
      1,
      rs,
      riders,
      {
        '10': { '1': '1', '2': '2', '3': '3' }, // 3 riders, max 2
        '11': { '1': '1', '2': '2', '3': 'sit-out' },
        '12': {},
      },
      2,
    );
    expect(warnings).toEqual([
      { kind: 'too-many-riders', raceKey: '10', message: 'Race 1: Bending has 3 riders assigned (maximum 2).' },
    ]);

    const few = validateHeatLineup(1, [race(10, 1, 'Solo')], riders, { '10': { '1': '1', '2': 'sit-out', '3': 'sit-out' } }, 2);
    expect(few[0]).toEqual({
      kind: 'too-few-riders',
      raceKey: '10',
      message: 'Race 1: Solo has only 1 of 2 riders assigned.',
    });
  });

  it('flags unbalanced sit-outs only when more core riders than slots, ignoring reserves and idle riders', () => {
    const riders = [rider(1, 'a'), rider(2, 'b'), rider(3, 'c'), rider(4, 'd'), rider(5, 'e'), rider(6, 'res', true), rider(7, 'idle')];
    const rs = [race(10, 1), race(11, 2), race(12, 3)];
    const row = (sit: string[]) =>
      Object.fromEntries(['1', '2', '3', '4', '5'].filter((k) => !sit.includes(k)).map((k, i) => [k, String(i + 1)]).concat(sit.map((k) => [k, 'sit-out'])));
    const plan = { '10': row(['5']), '11': row(['5']), '12': row(['5']) };
    const warnings = validateHeatLineup(1, rs, riders, plan, 4);
    const unbalanced = warnings.filter((w) => w.kind === 'unbalanced-sit-outs');
    expect(unbalanced).toEqual([
      { kind: 'unbalanced-sit-outs', riderKey: '5', message: 'e sits out 3 races while another rider sits out 0.' },
    ]);

    // exactly 4 core riders: no balance check
    const small = validateHeatLineup(1, rs, riders.slice(0, 4), { '10': { '1': '1', '2': '2', '3': '3', '4': '4' } }, 4);
    expect(small).toEqual([]);
  });
});
