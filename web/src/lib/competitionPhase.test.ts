import { describe, expect, it } from 'vitest';
import { competition, heat, session, team } from '../test/factories';
import { competitionPhase, entryPhaseOnly } from './competitionPhase';
import type { CompetitionSection } from '../types';

const section = { id: 5, competitionId: 1, format: 1, ageGroup: 'U12', displayName: 'Under 12', priceMinor: 0 } as CompetitionSection;

describe('competitionPhase', () => {
  it('is the entry phase for a new competition with sections and nothing else', () => {
    expect(competitionPhase(competition({ sections: [section] }))).toBe('entry');
  });

  it('is not the entry phase with no sections, as there is nothing to enter', () => {
    expect(competitionPhase(competition())).toBe('running');
  });

  it('ends once any team is formed', () => {
    expect(competitionPhase(competition({ sections: [section], teams: [team(1)] }))).toBe('running');
  });

  it('ends once the timetable has heats in it', () => {
    expect(competitionPhase(competition({ sections: [section], sessions: [session(1, { heats: [heat(1)] })] }))).toBe('running');
  });

  it('ignores a bare session or break with no heats', () => {
    expect(competitionPhase(competition({ sections: [section], sessions: [session(1), session(2, { isBreak: true })] }))).toBe('entry');
  });

  it('ends once a session has started', () => {
    expect(competitionPhase(competition({ sections: [section], sessions: [session(1, { status: 1 })] }))).toBe('running');
  });

  it('is never the entry phase for an archived competition', () => {
    expect(competitionPhase(competition({ sections: [section], isArchived: true }))).toBe('running');
  });
});

describe('entryPhaseOnly', () => {
  it('narrows the public to the entry page, but never an organiser', () => {
    const fresh = competition({ sections: [section] });
    expect(entryPhaseOnly(fresh, false)).toBe(true);
    expect(entryPhaseOnly(fresh, true)).toBe(false);
  });

  it('does nothing once the competition is running', () => {
    expect(entryPhaseOnly(competition({ sections: [section], teams: [team(1)] }), false)).toBe(false);
  });
});
