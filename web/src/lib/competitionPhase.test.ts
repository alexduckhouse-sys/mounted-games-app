import { describe, expect, it } from 'vitest';
import { competition, heat, race, session, team } from '../test/factories';
import { competitionPhase, detectPhase, entryPhaseOnly } from './competitionPhase';
import type { CompetitionSection } from '../types';

const section = { id: 5, competitionId: 1, format: 1, ageGroup: 'U12', displayName: 'Under 12', priceMinor: 0 } as CompetitionSection;

describe('competitionPhase', () => {
  it('is the entry phase for a new competition with sections and nothing else', () => {
    expect(competitionPhase(competition({ sections: [section] }))).toBe('entry');
    expect(detectPhase(competition({ sections: [section] }))).toBe('entry');
  });

  it('is not the entry phase with no sections, as there is nothing to enter', () => {
    expect(competitionPhase(competition())).toBe('running');
  });

  it('stays in the entry phase when teams exist but no timetable or heats have been generated', () => {
    expect(competitionPhase(competition({ sections: [section], teams: [team(1)] }))).toBe('entry');
  });

  it('switches to running once the timetable has heats in it', () => {
    expect(competitionPhase(competition({ sections: [section], sessions: [session(1, { heats: [heat(1)] })] }))).toBe('running');
  });

  it('ignores a bare session or break with no heats', () => {
    expect(competitionPhase(competition({ sections: [section], sessions: [session(1), session(2, { isBreak: true })] }))).toBe('entry');
  });

  it('switches to running once a session has started', () => {
    expect(competitionPhase(competition({ sections: [section], sessions: [session(1, { status: 1 })] }))).toBe('running');
  });

  it('switches to complete once finals have completed', () => {
    const qual = session(1, { status: 2, heats: [heat(1, { races: [race(1, { isComplete: true })] })] });
    const finalSession = session(2, { name: 'Under 12 Finals', status: 2, heats: [heat(2, { label: 'A Final', raceRoundStage: 2, races: [race(2, { isComplete: true })] })] });
    expect(competitionPhase(competition({ sections: [section], sessions: [qual, finalSession] }))).toBe('complete');
  });

  it('is never the entry phase for an archived competition', () => {
    expect(competitionPhase(competition({ sections: [section], isArchived: true }))).toBe('running');
  });
});

describe('entryPhaseOnly', () => {
  it('shows the entry page at home for the public before heats exist, even if teams exist, but never for an organiser', () => {
    const fresh = competition({ sections: [section], teams: [team(1)] });
    expect(entryPhaseOnly(fresh, false)).toBe(true);
    expect(entryPhaseOnly(fresh, true)).toBe(false);
  });

  it('does nothing once the timetable has heats', () => {
    expect(entryPhaseOnly(competition({ sections: [section], sessions: [session(1, { heats: [heat(1)] })] }), false)).toBe(false);
  });
});
