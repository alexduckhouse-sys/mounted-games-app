import { describe, expect, it } from 'vitest';
import { defaultDraft, defaultSection, type CreatorDraft, type SectionDraft } from './creatorDraft';
import { expectedTeams, plannedSessions, plannedWrites, provisionalTimetable, sectionEstimate } from './creatorPlan';

const at = (h: number, m = 0) => new Date(2026, 9, 31, h, m);
const section = (extra: Partial<SectionDraft> = {}): SectionDraft => ({ ...defaultSection(), ...extra });
const draft = (sections: SectionDraft[], extra: Partial<CreatorDraft> = {}): CreatorDraft => ({
  ...defaultDraft(new Date(2026, 9, 31)), name: 'Zone', startDate: '2026-10-31', startTime: '09:00', endDate: '', endTime: '17:00', sections, ...extra,
});
const races = (n: number) => Array.from({ length: n }, (_, i) => `R${i}`);

describe('expectedTeams with an unknown format', () => {
  it('treats a format with no known team size as one rider per team and guesses six teams', () => {
    const odd = 9 as never;
    expect(expectedTeams(section({ format: odd, maxParticipants: '7' }))).toEqual({ count: 7, basis: 'cap' });
    expect(expectedTeams(section({ format: odd }))).toEqual({ count: 6, basis: 'guess' });
  });

  it('ignores a zero or unreadable entry limit', () => {
    expect(expectedTeams(section({ maxParticipants: '0' })).basis).toBe('guess');
    expect(expectedTeams(section({ maxParticipants: 'abc' })).basis).toBe('guess');
  });

  it('always plans for at least one team', () => {
    expect(expectedTeams(section({ format: 2, maxParticipants: '1' }))).toEqual({ count: 1, basis: 'cap' });
  });
});

describe('plannedSessions details', () => {
  it('uses team counts only for sections that exist, defaulting to zero when none is known', () => {
    const d = draft([
      section({ existingId: 4, sessions: [{ races: races(2) }] }),
      section({ sessions: [{ races: races(2) }] }),
    ]);
    const plan = plannedSessions(d);
    expect(plan[0].teams.basis).toBe('guess');
    expect(plan[1].teams.basis).toBe('guess');
    expect(plannedSessions(d, { 4: 3 })[0].teams).toEqual({ count: 3, basis: 'teams' });
    expect(plannedSessions(d, { 99: 3 })[0].teams.basis).toBe('guess');
  });

  it('keeps a typed session name and falls back to the main arena for a blank one', () => {
    const d = draft([section({ arena: '   ', sessions: [{ name: 'Custom', races: races(1) }] })]);
    const [p] = plannedSessions(d);
    expect(p).toMatchObject({ name: 'Custom', arena: 'Main arena', fixed: false });
    expect(plannedSessions(draft([section({ arena: ' Ring 2 ', sessions: [{ races: races(1) }] })]))[0].arena).toBe('Ring 2');
  });
});

describe('provisionalTimetable details', () => {
  it('skips breaks with an incomplete window and names unnamed ones', () => {
    const d = draft([section({ sessions: [{ races: races(2) }], minutesPerRace: '10' })], {
      breaks: [
        { kind: 1, name: 'Broken', date: '', time: '12:00', minutes: '30', arena: '' },
        { kind: 1, name: '  ', date: '2026-10-31', time: '12:00', minutes: '30', arena: '' },
        { kind: 2, name: 'Rider briefing', date: '2026-10-31', time: '08:00', minutes: '15', arena: 'Main arena' },
      ],
    });
    const { rows } = provisionalTimetable(d);
    expect(rows.map((r) => [r.kind, r.name])).toEqual([['briefing', 'Rider briefing'], ['session', 'Seniors'], ['break', 'Break']]);
    const brk = rows.find((r) => r.kind === 'break')!;
    expect(brk).toMatchObject({ breakKey: 1, minutes: 30, detail: '', arena: '' });
    expect(rows.find((r) => r.kind === 'briefing')).toMatchObject({ breakKey: 2, arena: 'Main arena' });
  });

  it('puts a break ahead of a session that starts at the same moment', () => {
    // A break in another arena at 09:00 does not move the session, so both start together.
    const d = draft([section({ sessions: [{ races: races(1) }], minutesPerRace: '10' })], {
      breaks: [{ kind: 1, name: 'Tea', date: '2026-10-31', time: '09:00', minutes: '20', arena: 'Other arena' }],
    });
    const { rows } = provisionalTimetable(d);
    expect(rows[0].start).toEqual(rows[1].start);
    expect(rows.map((r) => r.kind)).toEqual(['break', 'session']);
  });

  it('keeps two sessions that start together in a stable order, around a break at the same moment', () => {
    const d = draft([
      section({ ageGroup: 'Open', sessions: [{ races: races(1) }] }),
      section({ ageGroup: 'Juniors', arena: 'Arena 2', sessions: [{ races: races(1) }] }),
    ], { breaks: [{ kind: 1, name: 'Tea', date: '2026-10-31', time: '09:00', minutes: '10', arena: 'Arena 3' }] });
    const { rows } = provisionalTimetable(d);
    expect(rows.map((r) => r.kind)).toEqual(['break', 'session', 'session']);
    expect(rows.slice(1).map((r) => r.arena)).toEqual(['Main arena', 'Arena 2']);
  });

  it('describes a single short heat in the singular', () => {
    const d = draft([section({ sessions: [{ races: races(1) }] })]);
    expect(provisionalTimetable(d).rows[0].detail).toBe('1 heat of 6, 1 race');
  });

  it('defaults the end time and end date when blank, and flags an overrun against them', () => {
    const d = draft([section({ sessions: [{ races: races(10) }], minutesPerRace: '600' })], { endDate: '', endTime: '' });
    // One heat of 600 minutes from 09:00 ends 19:00, after the 17:00 default.
    expect(provisionalTimetable(d).overrun).toBe(true);
    expect(provisionalTimetable({ ...d, endDate: '2026-10-31', endTime: '23:00' }).overrun).toBe(false);
  });

  it('is not an overrun when the end time cannot be read', () => {
    const d = draft([section({ sessions: [{ races: races(2) }] })], { endTime: 'xx' });
    expect(provisionalTimetable(d).overrun).toBe(false);
  });

  it('falls back to now for an unreadable start and still produces rows', () => {
    const d = draft([section({ sessions: [{ races: races(1) }] })], { startDate: 'nope' });
    const { rows } = provisionalTimetable(d);
    expect(rows).toHaveLength(1);
    expect(Number.isNaN(rows[0].start.getTime())).toBe(false);
  });

  it('leaves out sessions that already have heats but keeps their space', () => {
    const d = draft([section({ sessions: [{ races: races(2), hasHeats: true }] })]);
    expect(provisionalTimetable(d).rows).toEqual([]);
    expect(provisionalTimetable(d).finishes).toBeNull();
  });

  it('applies known team counts', () => {
    const d = draft([section({ existingId: 2, sessions: [{ races: races(2) }] })]);
    expect(provisionalTimetable(d, { 2: 12 }).rows[0].detail).toBe('2 heats of 6, 2 races');
  });
});

describe('plannedWrites and sectionEstimate defaults', () => {
  it('maps planned sessions to their estimated start and length', () => {
    const d = draft([section({ sessions: [{ races: races(2) }], minutesPerRace: '10' })]);
    expect(plannedWrites(d, {}, []).get(0)).toEqual({ start: at(9), minutes: 10 });
    expect(plannedWrites(d, {}, [{ start: at(9), end: at(10), arena: 'Main arena' }]).get(0)?.start).toEqual(at(10));
  });

  it('estimates from real teams when given', () => {
    expect(sectionEstimate(section({ sessions: [{ races: races(1) }], minutesPerRace: '10' }), 13)).toMatchObject({
      teams: { count: 13, basis: 'teams' }, sizes: [5, 4, 4], minutesPerSession: 30,
    });
  });
});
