import { describe, expect, it } from 'vitest';
import { competition, heat, race, session, team } from '../test/factories';
import type { CompetitionSection } from '../types';
import { draftFromCompetition, hasScores, realFixedItems, teamCountsOf } from './creatorLoad';

const sec = (id: number, extra: Partial<CompetitionSection> = {}): CompetitionSection => ({
  id, competitionId: 1, format: 2, ageGroup: 'Seniors', displayName: 'Senior Teams', ...extra,
});

describe('draftFromCompetition', () => {
  it('opens a competition with nothing planned: one session per age group, races left for later', () => {
    const d = draftFromCompetition(competition({
      name: 'Old', startDate: '2026-06-01T08:30:00', endDate: '2026-06-02T16:00:00', icon: undefined, organiserName: 'Pony Club', location: 'Field',
      latitude: 51.5, longitude: -1.2, what3Words: 'a.b.c', termsText: 'T', paymentDestination: 'Bank', description: 'Notes', laneHatbands: ['Blue', 'Red'],
      sections: [sec(5, { priceMinor: 1250, maxParticipants: 20, finalistCount: 6, runoffRaceName: '2 Flag', usesRaceFinals: true })],
    }));
    expect(d).toMatchObject({
      name: 'Old', icon: 'flag', startDate: '2026-06-01', startTime: '08:30', endDate: '2026-06-02', endTime: '16:00', organiserName: 'Pony Club',
      lat: '51.5', lon: '-1.2', what3Words: 'a.b.c', termsText: 'T', paymentDestination: 'Bank', description: 'Notes', step: 0, laneHatbands: ['Blue', 'Red'],
    });
    expect(d.sections[0]).toMatchObject({
      existingId: 5, ageGroup: 'Seniors', priceGbp: '12.50', maxParticipants: '20', finalistCount: '6', runoffRaceName: '2 Flag', usesRaceFinals: true,
      minutesPerRace: '10', maxTeamsPerHeat: '6', arena: 'Main arena', sessions: [{ races: null }],
    });
    expect(d.sections[0].hasEntries).toBeUndefined();
  });

  it('keeps the sessions with their structure, planned races and whether heats or scores exist', () => {
    const d = draftFromCompetition(competition({
      sections: [sec(5, { format: 1, activeSignupsCount: 2 })],
      sessions: [
        session(2, { name: 'B', orderIndex: 2, plannedRaces: ['Bending'], arenaName: ' Arena 2 ', minutesPerHeat: 7, lanesPerHeat: 3 }),
        session(1, { name: 'A', orderIndex: 1, plannedRaces: [], heats: [heat(1, { races: [race(1, { isComplete: true })] })] }),
        session(3, { name: 'C', orderIndex: 3, status: 2 }),
        session(4, { name: 'Finals · Senior Pairs', orderIndex: 4, plannedRaces: ['Flag', 'Mug'], status: 1, heats: [heat(2)] }),
      ],
    }));
    const [s] = d.sections;
    expect(s.sessions.map((x) => x.name)).toEqual(['A', 'B', 'C']);
    expect(s.sessions[0]).toMatchObject({ existingId: 1, races: null, hasHeats: true, scored: true });
    expect(s.sessions[1]).toMatchObject({ existingId: 2, races: ['Bending'] });
    expect(s.sessions[2]).toMatchObject({ scored: true });
    expect(s).toMatchObject({ format: 1, hasEntries: true, maxTeamsPerHeat: '4', minutesPerRace: '10', finalRaces: ['Flag', 'Mug'], finalSessionId: 4, finalHasHeats: true, finalScored: true });
  });

  it('takes timing from the first session and marks sections that have teams', () => {
    const d = draftFromCompetition(competition({
      sections: [sec(5), sec(6, { format: 9 as never })],
      teams: [team(1, { competitionSectionId: 6 })],
      sessions: [session(1, { competitionSectionId: 5, minutesPerHeat: 7, lanesPerHeat: 3, arenaName: ' Arena 2 ' })],
    }));
    expect(d.sections[0]).toMatchObject({ minutesPerRace: '7', maxTeamsPerHeat: '3', arena: 'Arena 2' });
    expect(d.sections[1]).toMatchObject({ format: 2, hasEntries: true });
  });

  it('lists breaks and briefings, with the time they start', () => {
    const d = draftFromCompetition(competition({
      startDate: '2026-06-01T09:00:00',
      sessions: [
        session(1, { competitionSectionId: null, name: 'Lunch', kind: 1, isBreak: true, orderIndex: 5, scheduledStart: '2026-06-01T12:15:00', durationMinutes: 45, arenaName: 'Arena 2' }),
        session(2, { competitionSectionId: null, name: 'Briefing', kind: 2, orderIndex: 4 }),
        session(3, { competitionSectionId: null, name: 'Old break', kind: undefined as never, isBreak: true, orderIndex: 6 }),
      ],
    }));
    expect(d.sections).toHaveLength(1);
    expect(d.breaks).toEqual([
      { existingId: 2, kind: 2, name: 'Briefing', date: '2026-06-01', time: '09:00', minutes: '30', arena: '' },
      { existingId: 1, kind: 1, name: 'Lunch', date: '2026-06-01', time: '12:15', minutes: '45', arena: 'Arena 2' },
      { existingId: 3, kind: 1, name: 'Old break', date: '2026-06-01', time: '09:00', minutes: '30', arena: '' },
    ]);
  });
});

describe('hasScores and teamCountsOf', () => {
  it('sees a started session or a completed race as scored', () => {
    expect(hasScores(session(1))).toBe(false);
    expect(hasScores(session(1, { status: 1 }))).toBe(true);
    expect(hasScores(session(1, { heats: [heat(1, { races: [race(1)] })] }))).toBe(false);
  });

  it('counts active teams by section', () => {
    expect(teamCountsOf(null)).toEqual({});
    expect(teamCountsOf(competition({ teams: [team(1), team(2), team(3, { competitionSectionId: 6 }), team(4, { isWithdrawn: true })] }))).toEqual({ 5: 2, 6: 1 });
  });
});

describe('realFixedItems', () => {
  it('lists only race sessions that have heats and a start, with where they end', () => {
    const heats = [heat(1, { durationMinutes: 30 }), heat(2, { durationMinutes: 20 })];
    const items = realFixedItems(competition({
      sessions: [
        session(1, { arenaName: ' Arena 2 ', scheduledStart: '2026-06-01T09:00:00', heats }),
        session(2, { scheduledStart: '2026-06-01T09:00:00' }),
        session(3, { heats }),
        session(4, { kind: 1, scheduledStart: '2026-06-01T12:00:00', heats }),
      ],
    }));
    expect(items).toEqual([{ start: new Date('2026-06-01T09:00:00'), end: new Date('2026-06-01T09:50:00'), arena: 'Arena 2' }]);
    expect(realFixedItems(null)).toEqual([]);
  });
});
