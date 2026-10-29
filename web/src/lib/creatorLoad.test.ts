import { describe, expect, it, vi } from 'vitest';
import { competition, heat, race, session, team } from '../test/factories';
import type { CompetitionSection } from '../types';
import { copyOfCompetition, draftFromCompetition, hasScores, realFixedItems, teamCountsOf } from './creatorLoad';

const sec = (id: number, extra: Partial<CompetitionSection> = {}): CompetitionSection => ({
  id, competitionId: 1, format: 2, ageGroup: 'Seniors', displayName: 'Senior Teams', ...extra,
});

describe('draftFromCompetition', () => {
  it('loads card visibility only for this competition and tolerates blocked device storage', () => {
    localStorage.setItem('mg.cardsEnabled.12', '1');
    expect(draftFromCompetition(competition({ id: 12 })).cardsEnabled).toBe(true);
    expect(draftFromCompetition(competition({ id: 13 })).cardsEnabled).toBe(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(draftFromCompetition(competition({ id: 12 })).cardsEnabled).toBe(false);
  });

  it('loads the postcode, competition number and contact email, and a copy keeps all but the number', () => {
    const c = competition({ postcode: 'GL19 3BE', competitionNumber: '2026-041', contactEmail: 'entries@example.org' });
    expect(draftFromCompetition(c)).toMatchObject({ postcode: 'GL19 3BE', competitionNumber: '2026-041', contactEmail: 'entries@example.org' });
    expect(copyOfCompetition(c)).toMatchObject({ postcode: 'GL19 3BE', competitionNumber: '', contactEmail: 'entries@example.org' });
    expect(draftFromCompetition(competition({ postcode: null }))).toMatchObject({ postcode: '', competitionNumber: '', contactEmail: '' });
  });

  it('loads the short name, and a copy keeps it', () => {
    const c = competition({ shortName: 'Midlands Pairs' });
    expect(draftFromCompetition(c)).toMatchObject({ shortName: 'Midlands Pairs' });
    expect(copyOfCompetition(c)).toMatchObject({ shortName: 'Midlands Pairs' });
    expect(draftFromCompetition(competition({ shortName: null }))).toMatchObject({ shortName: '' });
  });

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

  it('loads the tie-break and lane order, and the arenas the age groups run in', () => {
    const d = draftFromCompetition(competition({
      sections: [sec(5, { tieBreakRule: 2 }), sec(6, { ageGroup: 'Open', displayName: 'Open' })],
      sessions: [
        session(1, { competitionSectionId: 5, orderIndex: 1, arenaName: 'Ring A', lanesPerHeat: 8, laneRotationMode: 1 }),
        session(2, { competitionSectionId: 6, orderIndex: 2, arenaName: 'Ring B', lanesPerHeat: 4 }),
      ],
    }));
    expect(d.sections[0]).toMatchObject({ tieBreak: 2, laneRotation: 1 });
    expect(d.sections[1].tieBreak).toBeUndefined();
    expect(d.sections[1].laneRotation).toBeUndefined();
    expect(d.arenas).toEqual([{ name: 'Ring A', lanes: '8' }, { name: 'Ring B', lanes: '4' }]);
  });

  it('loads the final options, treating missing ones as a final that carries no points and does not double', () => {
    const d = draftFromCompetition(competition({ sections: [sec(5), sec(6, { hasFinal: false, carryPointsIntoFinal: true, doublePointsInFinal: true })] }));
    expect(d.sections[0]).toMatchObject({ hasFinal: true, carryPointsIntoFinal: false, doublePointsInFinal: false });
    expect(d.sections[1]).toMatchObject({ hasFinal: false, carryPointsIntoFinal: true, doublePointsInFinal: true });
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

  it('loads the B and C finals own race lists from the finals session', () => {
    const d = draftFromCompetition(competition({
      sections: [sec(5)],
      sessions: [
        session(4, { name: 'Finals · Senior Pairs', orderIndex: 4, plannedRaces: ['Flag'], plannedFinalRaces: { B: ['Mug', 'Pole'], C: ['Relay'] } }),
        session(5, { name: 'Open', orderIndex: 5 }),
      ],
    }));
    expect(d.sections[0]).toMatchObject({ finalRaces: ['Flag'], finalRacesB: ['Mug', 'Pole'], finalRacesC: ['Relay'] });
    const none = draftFromCompetition(competition({
      sections: [sec(5)],
      sessions: [session(4, { name: 'Finals · Senior Pairs', orderIndex: 4, plannedRaces: ['Flag'], plannedFinalRaces: { B: [] } })],
    }));
    expect(none.sections[0]).not.toHaveProperty('finalRacesB');
    expect(none.sections[0]).not.toHaveProperty('finalRacesC');
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

describe('copyOfCompetition', () => {
  it('keeps every step and drops what belongs to the old event: dates, saved ids, breaks and heats', () => {
    const c = competition({
      name: 'Spring 2026', startDate: '2026-04-25T09:00:00', endDate: '2026-04-26T17:00:00', location: 'Stoneleigh', laneHatbands: ['Red', 'Blue'],
      sections: [sec(5, { priceMinor: 4500, maxParticipants: 12, activeSignupsCount: 3, tieBreakRule: 1 })],
      teams: [team(1, { competitionSectionId: 5 })],
      sessions: [
        session(1, { competitionSectionId: 5, orderIndex: 1, plannedRaces: ['Bending'], heats: [heat(1, { races: [race(1, { isComplete: true })] })], status: 2 }),
        session(2, { competitionSectionId: 5, orderIndex: 2, plannedRaces: ['Bending'] }),
        session(3, { name: 'Finals · Senior Teams', competitionSectionId: 5, orderIndex: 3, plannedRaces: ['Flag'], heats: [heat(2)] }),
        session(4, { competitionSectionId: null, kind: 1, isBreak: true, name: 'Lunch', orderIndex: 4 }),
      ],
    });
    const d = copyOfCompetition(c);
    expect(d).toMatchObject({ name: 'Spring 2026', startDate: '', endDate: '', location: 'Stoneleigh', laneHatbands: ['Red', 'Blue'], startFrom: 'copy', copiedFrom: 'Spring 2026', breaks: [], step: 0 });
    const s = d.sections[0];
    expect(s).toMatchObject({ ageGroup: 'Seniors', priceGbp: '45.00', maxParticipants: '12', tieBreak: 1, finalRaces: ['Flag'] });
    expect(s.sessions).toEqual([{ races: ['Bending'] }, { races: ['Bending'] }]);
    for (const key of ['existingId', 'finalSessionId', 'finalHasHeats', 'finalScored', 'hasEntries'] as const) expect(s).not.toHaveProperty(key);
    expect(s.sessions.every((x) => x.hasHeats === undefined && x.scored === undefined && x.existingId === undefined)).toBe(true);
  });
});
