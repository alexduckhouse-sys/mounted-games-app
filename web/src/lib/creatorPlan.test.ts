import { describe, expect, it } from 'vitest';
import { defaultDraft, defaultSection, resizeSessions, setRaceFinals, type CreatorDraft, type SectionDraft } from './creatorDraft';
import {
  breakWindow, durationText, estimateText, expectedTeams, plannedSessions, plannedWrites, provisionalTimetable, raceCountFor, sectionEstimate, sectionNames,
} from './creatorPlan';

const at = (h: number, m = 0) => new Date(2026, 9, 31, h, m);
const section = (extra: Partial<SectionDraft> = {}): SectionDraft => ({ ...defaultSection(), ...extra });
const draft = (sections: SectionDraft[], extra: Partial<CreatorDraft> = {}): CreatorDraft => ({
  ...defaultDraft(new Date(2026, 9, 31)), name: 'Zone', startDate: '2026-10-31', startTime: '09:00', endDate: '', endTime: '17:00', sections, ...extra,
});
const tenRaces = (n = 10) => Array.from({ length: n }, (_, i) => `R${i}`);

describe('expectedTeams', () => {
  it('prefers real teams, then the entry limit per riders in a team, then a guess', () => {
    expect(expectedTeams(section(), 5)).toEqual({ count: 5, basis: 'teams' });
    expect(expectedTeams(section({ maxParticipants: '24' }))).toEqual({ count: 6, basis: 'cap' });
    expect(expectedTeams(section({ format: 1, maxParticipants: '9' }))).toEqual({ count: 5, basis: 'cap' });
    expect(expectedTeams(section({ format: 3, maxParticipants: '9' }))).toEqual({ count: 9, basis: 'cap' });
    expect(expectedTeams(section())).toEqual({ count: 6, basis: 'guess' });
    expect(expectedTeams(section({ format: 3 })).count).toBe(12);
    expect(expectedTeams(section({ format: 1 })).count).toBe(8);
  });

  it('says where the number came from', () => {
    expect(estimateText({ count: 5, basis: 'teams' })).toBe('5 teams entered');
    expect(estimateText({ count: 6, basis: 'cap' })).toBe('about 6 teams, from the entry limit');
    expect(estimateText({ count: 6, basis: 'guess' })).toBe('a guess of 6 teams');
  });
});

describe('plannedSessions', () => {
  it('lists every session, section by section, with names and the races to plan for', () => {
    const d = draft([
      resizeSessions(section({ ageGroup: 'Open' }), 2),
      section({ ageGroup: 'Juniors', existingId: 3, sessions: [{ existingId: 8, name: 'Juniors', races: ['A', 'B'], hasHeats: true }] }),
    ]);
    const plan = plannedSessions(d, { 3: 4 });
    expect(plan.map((p) => p.name)).toEqual(['Open Teams · Session 1', 'Open Teams · Session 2', 'Juniors']);
    expect(plan[0].races).toBe(10);
    expect(plan[0].racesChosen).toBe(false);
    expect(plan[2]).toMatchObject({ races: 2, racesChosen: true, fixed: true, existingId: 8 });
    expect(plan[2].teams).toEqual({ count: 4, basis: 'teams' });
    expect(plan[0].teams.basis).toBe('guess');
  });

  it('plans for the standard list when the races are left for later', () => {
    expect(raceCountFor(section(), { races: null })).toBe(10);
    expect(raceCountFor(section(), { races: ['Bending'] })).toBe(1);
  });
});

describe('provisionalTimetable', () => {
  it('works out heats, minutes and start times from the structure', () => {
    // 6 teams guessed, heat size 6: one whole heat takes 10 minutes.
    const d = draft([section({ sessions: [{ races: tenRaces() }] })]);
    const { rows, finishes, overrun } = provisionalTimetable(d);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'session', name: 'Senior Teams', minutes: 10, start: at(9), end: at(9, 10) });
    expect(rows[0].detail).toBe('1 heat of 6, 10 races');
    expect(finishes).toEqual(at(9, 10));
    expect(overrun).toBe(false);
  });

  it('splits a large section into heats and uses the entry limit', () => {
    const d = draft([section({ maxParticipants: '40', maxTeamsPerHeat: '4', minutesPerRace: '5', sessions: [{ races: tenRaces(4) }] })]);
    // 40 riders / 4 = 10 teams, heats of 4: 4,3,3. 3 whole heats x 5 minutes = 15.
    const { rows } = provisionalTimetable(d);
    expect(rows[0].minutes).toBe(15);
    expect(rows[0].detail).toBe('3 heats (4, 3, 3), 4 races');
  });

  it('runs sessions in the same arena one after another with a gap, and other arenas alongside', () => {
    const d = draft([
      section({ ageGroup: 'Open', sessions: [{ races: tenRaces(2) }], minutesPerRace: '10' }),
      section({ ageGroup: 'Juniors', sessions: [{ races: tenRaces(2) }], minutesPerRace: '10' }),
      section({ ageGroup: 'Novices', arena: 'Arena 2', sessions: [{ races: tenRaces(2) }], minutesPerRace: '10' }),
    ]);
    const starts = provisionalTimetable(d).rows.filter((r) => r.kind === 'session').map((r) => [r.name, r.start] as const);
    expect(starts).toContainEqual(['Open Teams', at(9)]);
    expect(starts).toContainEqual(['Junior Teams', at(9, 20)]);
    expect(starts).toContainEqual(['Novice Teams', at(9)]);
  });

  it('works around breaks and briefings, which stay in the list', () => {
    const d = draft([section({ sessions: [{ races: tenRaces(2) }], minutesPerRace: '10' })], {
      breaks: [{ kind: 1, name: 'Lunch', date: '2026-10-31', time: '09:00', minutes: '45', arena: '' }, { kind: 2, name: '', date: '2026-10-31', time: '08:30', minutes: '15', arena: '' }],
    });
    const { rows } = provisionalTimetable(d);
    expect(rows.map((r) => [r.kind, r.name, r.start.getHours() * 60 + r.start.getMinutes()])).toEqual([
      ['briefing', 'Briefing', 510], ['break', 'Lunch', 540], ['session', 'Senior Teams', 585],
    ]);
  });

  it('uses three whole-heat durations for heat, heat, final', () => {
    const d = draft([setRaceFinals(section({ sessions: [{ races: tenRaces(5) }], minutesPerRace: '4' }), true)]);
    const { rows } = provisionalTimetable(d);
    expect(rows[0].minutes).toBe(12);
    expect(rows[0].detail).toBe('5 races, each a heat, heat, final');
  });

  it('warns when the day runs past the end time, using the end date when there is one', () => {
    const long = draft([section({ sessions: [{ races: tenRaces(10) }], minutesPerRace: '60' })], { endTime: '09:30' });
    expect(provisionalTimetable(long).overrun).toBe(true);
    expect(provisionalTimetable({ ...long, endDate: '2026-11-02' }).overrun).toBe(false);
  });

  it('has no finish time when nothing takes time, and shrugs at unreadable dates', () => {
    const empty = provisionalTimetable(draft([section({ sessions: [{ races: tenRaces(1) }], format: 2 })], { startDate: '', startTime: '' }));
    expect(empty.rows).toHaveLength(1);
    const none = provisionalTimetable(draft([section({ maxParticipants: '', sessions: [{ races: [] }] })]));
    expect(none.rows).toHaveLength(1);
    expect(provisionalTimetable({ ...draft([]), sections: [] }).finishes).toBeNull();
  });

  it('works around sessions that already have real times', () => {
    const d = draft([section({ sessions: [{ races: tenRaces(2) }], minutesPerRace: '10' })]);
    const { rows } = provisionalTimetable(d, {}, [{ start: at(9), end: at(10), arena: 'Main arena' }]);
    expect(rows[0].start).toEqual(at(10));
  });

  it('gives every session without heats a start and length to save', () => {
    const d = draft([
      section({ ageGroup: 'Open', sessions: [{ races: tenRaces(2) }] }),
      section({ ageGroup: 'Juniors', sessions: [{ races: tenRaces(2), hasHeats: true }] }),
    ]);
    const writes = plannedWrites(d);
    expect([...writes.keys()]).toEqual([0]);
    expect(writes.get(0)).toEqual({ start: at(9), minutes: 10 });
  });
});

describe('sectionEstimate and durationText', () => {
  it('works out teams, heats and the length of a session for one age group', () => {
    expect(sectionEstimate(section({ maxParticipants: '40', maxTeamsPerHeat: '4', minutesPerRace: '5', sessions: [{ races: tenRaces(4) }] }))).toEqual({
      teams: { count: 10, basis: 'cap' }, sizes: [4, 3, 3], minutesPerSession: 15,
    });
    expect(sectionEstimate(setRaceFinals(section({ sessions: [{ races: tenRaces(5) }], minutesPerRace: '4' }), true), 8).minutesPerSession).toBe(12);
    expect(sectionEstimate(section({ sessions: [] })).minutesPerSession).toBe(0);
  });

  it('writes a length of time in words', () => {
    expect(durationText(45)).toBe('45 min');
    expect(durationText(100)).toBe('1 h 40 min');
    expect(durationText(120)).toBe('2 h');
  });
});

describe('small helpers', () => {
  it('reads a break window, or nothing when it is incomplete', () => {
    const b = { kind: 1 as const, name: 'x', date: '2026-10-31', time: '12:00', minutes: '30', arena: '' };
    expect(breakWindow(b)).toEqual({ start: at(12), end: at(12, 30) });
    expect(breakWindow({ ...b, minutes: '' })).toBeNull();
    expect(breakWindow({ ...b, date: '' })).toBeNull();
    expect(breakWindow({ ...b, time: 'xx' })).toBeNull();
  });

  it('names the age groups', () => {
    expect(sectionNames(draft([section({ ageGroup: 'Juniors', format: 3 }), section({ ageGroup: 'Open' })]))).toEqual(['Junior Individuals', 'Open Teams']);
  });
});
