import { describe, expect, it } from 'vitest';
import { competition, heat, race, session, team } from '../test/factories';
import { competitionPhase, detectPhase, entryPhaseOnly, entryFeeText } from './competitionPhase';
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

  it('waits for unfinished qualifiers even when the final has a finish time', () => {
    const final = session(2, { name: 'Finals', heats: [heat(2, { finishedAt: '2030-06-01T12:00:00Z' })] });
    const qualifying = session(1, { heats: [heat(1, { label: 'Qualifier', races: [race(1)] })] });
    expect(competitionPhase(competition({ sections: [section], sessions: [qualifying, final] }))).toBe('running');
    qualifying.heats[0].races[0].isComplete = true;
    expect(competitionPhase(competition({ sections: [section], sessions: [qualifying, final] }))).toBe('complete');
  });

  it('requires every race in every final heat unless the heat has been finished explicitly', () => {
    const finals = session(2, { name: 'Finals', heats: [heat(2, { races: [race(1, { isComplete: true }), race(2)] })] });
    expect(competitionPhase(competition({ sessions: [finals] }))).toBe('running');
    finals.heats[0].races[1].isComplete = true;
    expect(competitionPhase(competition({ sessions: [finals] }))).toBe('complete');
    finals.heats[0].races = [];
    expect(competitionPhase(competition({ sessions: [finals] }))).toBe('running');
  });

  it('reads saved legacy sessions without kind or heat arrays and ignores breaks for finals', () => {
    const legacy = session(1, { kind: undefined, heats: undefined } as never);
    expect(competitionPhase(competition({ sections: [section], sessions: [legacy] }))).toBe('entry');
    const finalBreak = session(2, { kind: undefined, isBreak: true, name: 'Final break', status: 2, heats: [heat(2)] });
    expect(competitionPhase(competition({ sections: [section], sessions: [finalBreak] }))).toBe('running');
  });

  it('treats a legacy section with no saved price as free when displaying entry fees', () => {
    expect(entryFeeText([{ ...section, priceMinor: undefined } as never, { ...section, id: 6, priceMinor: 500 }])).toBe('From free to £5.00');
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
