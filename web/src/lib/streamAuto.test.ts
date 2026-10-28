import { beforeEach, describe, expect, it, vi } from 'vitest';
import { competition, heat, race, session } from '../test/factories';
import { AUTO_RULES, DEFAULT_AUTO, autoContext, autoStatus, autoSteps, finishedRaces, loadAuto, nextRaceName, parseAuto, saveAuto } from './streamAuto';

const comp = () => competition({
  sessions: [
    session(1, { orderIndex: 1, competitionSectionId: 5, heats: [heat(1, { races: [race(1, { isComplete: true }), race(2, { isComplete: true })] })] }),
    session(2, { orderIndex: 2, competitionSectionId: 5, heats: [heat(2, { races: [race(3, { isComplete: true }), race(4, { name: 'Mug' })] })] }),
    session(3, { orderIndex: 3, competitionSectionId: 5, isBreak: true, kind: 1, heats: [heat(3, { races: [race(9, { isComplete: true })] })] }),
    session(4, { orderIndex: 1, competitionSectionId: 6, heats: [heat(4, { races: [race(5, { isComplete: true })] })] }),
  ],
});

describe('parseAuto and storage', () => {
  beforeEach(() => localStorage.clear());

  it('is off by default and repairs bad data', () => {
    expect(parseAuto(null)).toEqual(DEFAULT_AUTO);
    expect(parseAuto({ on: true, rules: { race: { on: false, n: 99 }, toplist: { on: 'x', n: 3 }, sponsor: { n: 20 } } })).toEqual({
      on: true,
      rules: { ...DEFAULT_AUTO.rules, race: { on: false, n: 20 }, toplist: { on: true, n: 3 }, sponsor: { on: false, n: 20 } },
    });
    expect(parseAuto([])).toEqual(DEFAULT_AUTO);
  });

  it('saves per competition and survives broken storage', () => {
    saveAuto(7, { ...DEFAULT_AUTO, on: true });
    expect(loadAuto(7).on).toBe(true);
    expect(loadAuto(8).on).toBe(false);
    localStorage.setItem('mg.streamAuto.9', '{oops');
    expect(loadAuto(9)).toEqual(DEFAULT_AUTO);
    const broken = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    expect(() => saveAuto(1, DEFAULT_AUTO)).not.toThrow();
    broken.mockRestore();
    const blocked = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(loadAuto(1)).toEqual(DEFAULT_AUTO);
    blocked.mockRestore();
  });
});

describe('autoSteps', () => {
  const on = { ...DEFAULT_AUTO, on: true };
  it('shows the heat table after each race', () => {
    expect(autoSteps(on, { sessionNumber: 1, racesInSection: 1, sessionFinished: false })).toEqual([{ card: 'heat', seconds: 20 }]);
  });
  it('adds the toplist from session 2 every n races', () => {
    expect(autoSteps(on, { sessionNumber: 2, racesInSection: 4, sessionFinished: false }).map((s) => s.card)).toEqual(['heat', 'toplist']);
    expect(autoSteps(on, { sessionNumber: 2, racesInSection: 3, sessionFinished: false }).map((s) => s.card)).toEqual(['heat']);
  });
  it('adds podium when a session is done, then title and sponsors when they are on', () => {
    const all = { on: true, rules: { race: { on: true, n: 10 }, toplist: { on: false, n: 1 }, podium: { on: true, n: 0 }, title: { on: true, n: 0 }, sponsor: { on: true, n: 10 }, favourites: { on: false, n: 0 } } };
    expect(autoSteps(all, { sessionNumber: 1, racesInSection: 2, sessionFinished: true })).toEqual([
      { card: 'heat', seconds: 10 }, { card: 'podium', seconds: 15 }, { card: 'title', seconds: 10 }, { card: 'sponsor', seconds: 10 },
    ]);
  });
  it('adds the favourites just before a final when that rule is on', () => {
    const rules = { ...on.rules, race: { on: false, n: 20 }, toplist: { on: false, n: 1 }, podium: { on: false, n: 0 }, favourites: { on: true, n: 0 } };
    expect(autoSteps({ on: true, rules }, { sessionNumber: 3, racesInSection: 9, sessionFinished: true, beforeFinal: true })).toEqual([{ card: 'favourites', seconds: 15 }]);
    expect(autoSteps({ on: true, rules }, { sessionNumber: 3, racesInSection: 9, sessionFinished: true, beforeFinal: false })).toEqual([]);
    expect(autoSteps(on, { sessionNumber: 3, racesInSection: 9, sessionFinished: true, beforeFinal: true }).map((s) => s.card)).not.toContain('favourites');
  });
  it('does nothing when every rule is off', () => {
    const none = { on: true, rules: { race: { on: false, n: 10 }, toplist: { on: false, n: 1 }, podium: { on: false, n: 0 }, title: { on: false, n: 0 }, sponsor: { on: false, n: 10 }, favourites: { on: false, n: 0 } } };
    expect(autoSteps(none, { sessionNumber: 2, racesInSection: 2, sessionFinished: true })).toEqual([]);
  });
});

describe('reading the timetable', () => {
  it('lists finished races in race sessions only', () => {
    expect(finishedRaces(comp()).map((r) => r.raceId)).toEqual([1, 2, 3, 5]);
  });
  it('works out session number, races so far and whether the session is finished', () => {
    expect(autoContext(comp(), 3)).toEqual({ sessionNumber: 2, racesInSection: 3, sessionFinished: false, beforeFinal: false });
    expect(autoContext(comp(), 2)).toEqual({ sessionNumber: 1, racesInSection: 3, sessionFinished: true, beforeFinal: false });
    expect(autoContext(comp(), 5)).toEqual({ sessionNumber: 1, racesInSection: 1, sessionFinished: true, beforeFinal: false });
    expect(autoContext(comp(), 404)).toBeNull();
  });
  it('knows when the last qualifying race has just been scored and finals are still to come', () => {
    const final = (complete: boolean) => session(2, { orderIndex: 2, competitionSectionId: 5, heats: [heat(2, { label: 'A Final', races: [race(3, { isComplete: complete })] })] });
    const qualifying = session(1, { orderIndex: 1, competitionSectionId: 5, heats: [heat(1, { races: [race(1, { isComplete: true }), race(2, { isComplete: true })] })] });
    expect(autoContext(competition({ sessions: [qualifying, final(false)] }), 2)?.beforeFinal).toBe(true);
    expect(autoContext(competition({ sessions: [qualifying, final(true)] }), 3)?.beforeFinal).toBe(false);
    expect(autoContext(competition({ sessions: [qualifying] }), 2)?.beforeFinal).toBe(false);
  });
  it('finds the next race and writes the status line', () => {
    expect(nextRaceName(comp())).toBe('Mug');
    expect(nextRaceName(competition({ sessions: [] }))).toBeNull();
    expect(autoStatus(DEFAULT_AUTO, 'Mug')).toBe('Off. Nothing changes on its own.');
    expect(autoStatus({ ...DEFAULT_AUTO, on: true }, 'Mug')).toBe('Next: heat table after Mug');
    expect(autoStatus({ ...DEFAULT_AUTO, on: true }, null)).toBe('On');
  });
  it('describes each rule', () => {
    expect(AUTO_RULES.map((r) => r.what(DEFAULT_AUTO.rules[r.key]))).toEqual([
      'Heat table for 20s', 'Toplist after every 2 races, for 20s', 'Podium for 15s', 'Race title for 10s', 'Sponsors for 10s', 'Favourites for 15s',
    ]);
    expect(AUTO_RULES[1].what({ on: true, n: 1 })).toBe('Toplist after every race, for 20s');
  });
});
