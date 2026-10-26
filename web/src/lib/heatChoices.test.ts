import { describe, expect, it } from 'vitest';
import { heat, race, session } from '../test/factories';
import { allHeats, arenaOf, canScoreHeat, currentHeatIn, groupOf, heatBarLabel, heatIsComplete, heatName, heatStatus } from './heatChoices';

const entry = (id: number) => ({ id, teamId: id, teamName: `T${id}`, laneIndex: id });
const done = (id: number) => race(id, { isComplete: true });

const sessions = [
  session(2, { orderIndex: 2, arenaName: 'Second Arena', name: 'Pairs', sectionName: null, heats: [heat(5, { orderIndex: 1, entries: [entry(1)], races: [race(50)] })] }),
  session(1, { orderIndex: 1, sectionName: 'Under 12', heats: [
    heat(2, { orderIndex: 2, label: ' ', entries: [entry(1)], races: [race(20), race(21)] }),
    heat(1, { orderIndex: 1, label: 'Heat A', entries: [entry(1)], races: [done(10), done(11)] }),
  ] }),
  session(3, { orderIndex: 3, kind: 1, isBreak: true, name: 'Lunch' }),
  session(4, { orderIndex: 4, heats: [heat(7, { orderIndex: 1, entries: [], races: [race(70)] })] }),
];

describe('heat choices', () => {
  const refs = allHeats(sessions);

  it('lists the heats of race sessions in the order the day runs them', () => {
    expect(refs.map((r) => r.heat.id)).toEqual([1, 2, 5, 7]);
    expect(refs.map((r) => r.index)).toEqual([0, 1, 0, 0]);
  });

  it('names the arena, heat and age group', () => {
    expect(arenaOf(sessions[1])).toBe('Main Arena');
    expect(arenaOf(sessions[0])).toBe('Second Arena');
    expect(groupOf(sessions[1])).toBe('Under 12');
    expect(groupOf(sessions[0])).toBe('Pairs');
    expect(heatName(refs[0].heat, 0)).toBe('Heat A');
    expect(heatName(refs[1].heat, 1)).toBe('Heat 2');
    expect(heatBarLabel(refs[1])).toBe('Under 12 · Heat 2');
  });

  it('finds the heat still to score in an arena, leaving out empty heats until nothing else is left', () => {
    expect(currentHeatIn(refs, 'Main Arena')?.heat.id).toBe(2);
    expect(currentHeatIn(refs, 'Second Arena')?.heat.id).toBe(5);
    expect(currentHeatIn(refs.filter((r) => r.heat.id !== 2), 'Main Arena')?.heat.id).toBe(7);
    expect(currentHeatIn(refs, 'Nowhere')).toBeNull();
    expect(heatIsComplete(refs[0].heat)).toBe(true);
    expect(heatIsComplete(heat(9))).toBe(false);
  });

  it('lets a scorer score the current heat and earlier ones, but not another arena or a later heat', () => {
    const by = (id: number) => refs.find((r) => r.heat.id === id)!;
    expect(canScoreHeat(refs, 'Main Arena', by(1))).toBe(true);
    expect(canScoreHeat(refs, 'Main Arena', by(2))).toBe(true);
    expect(canScoreHeat(refs, 'Main Arena', by(7))).toBe(false);
    expect(canScoreHeat(refs, 'Main Arena', by(5))).toBe(false);
    expect(canScoreHeat(refs, 'Second Arena', by(5))).toBe(true);
    const started = allHeats([session(1, { heats: [heat(1, { startedAt: '2026-06-01T10:00:00Z', entries: [entry(1)], races: [race(1)] }), heat(2, { orderIndex: 2, entries: [entry(2)], races: [race(2)] })] })]);
    expect(canScoreHeat(started, 'Main Arena', started[0])).toBe(true);
    expect(canScoreHeat(started, 'Main Arena', started[1])).toBe(false);
  });

  it('says where a heat has got to', () => {
    expect(heatStatus(refs[0])).toBe('Finished');
    const midway = allHeats([session(1, { heats: [heat(1, { races: [done(1), race(2), race(3)] })] })])[0];
    expect(heatStatus(midway)).toBe('Scoring · race 2 of 3');
    const running = allHeats([session(1, { heats: [heat(1, { startedAt: '2026-06-01T10:00:00Z', races: [race(1)] })] })])[0];
    expect(heatStatus(running)).toBe('Scoring · race 1 of 1');
    expect(heatStatus(refs[3])).toBe('Not started');
    const timed = allHeats([session(1, { scheduledStart: '2026-06-01T12:30:00', heats: [heat(1, { races: [race(1)] })] })])[0];
    expect(heatStatus(timed)).toMatch(/^Not started · \d{2}:\d{2}$/);
    const odd = allHeats([session(1, { heats: [heat(1, { scheduledStart: 'nonsense', races: [race(1)] })] })])[0];
    expect(heatStatus(odd)).toBe('Not started');
  });
});
