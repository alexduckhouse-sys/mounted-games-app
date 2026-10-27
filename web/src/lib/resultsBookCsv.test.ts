import { describe, expect, it, vi } from 'vitest';
import type { ResultsBook } from '../pages/eventTools/resultsBookTypes';
import {
  copyPublicResultsSummary,
  formatPublicResultsSummary,
  resultsBookFileName,
  resultsBookToCsv,
  safeCell,
} from './resultsBookCsv';

const book = (extra: Partial<ResultsBook> = {}): ResultsBook => ({
  competition: { id: 1, name: 'Spring Games', location: 'Oak Farm', startDate: '2031-05-04T09:00:00Z', endDate: null },
  isProvisional: false,
  includesPrivate: false,
  generatedAt: '2031-05-04T18:00:00Z',
  sections: [{
    sectionId: 5, sectionName: 'Under 12 Teams', format: 2,
    standings: [
      { rank: 1, teamId: 1, teamName: 'Oak A', clubName: 'Oak, Pony Club', finalLabel: 'A Final', totalPoints: 30, bonusPoints: 0, racesRun: 6, wins: 3, eliminations: 0, withdrawn: false },
      { rank: 2, teamId: 2, teamName: '=HYPERLINK("x")', clubName: 'Beech', finalLabel: 'A Final', totalPoints: 24, bonusPoints: 0, racesRun: 6, wins: 1, eliminations: 1, withdrawn: true },
    ],
    finals: [{ label: 'A Final', sessionName: 'Finals', raceNames: ['Bending', 'Mug'], rows: [
      { rank: 1, teamId: 1, teamName: 'Oak A', clubName: 'Oak', points: 9, raceCells: ['5', '4'] },
      { rank: 2, teamId: 2, teamName: 'Beech B', clubName: 'Beech', points: 0, raceCells: ['DNF', 'DNS'] },
    ] }],
    awards: [{ id: 1, competitionSectionId: 5, title: 'Best turned out', recipient: 'Oak A', note: null }],
  }],
  eventAwards: [{ id: 2, competitionSectionId: null, title: 'Spirit of the Games', recipient: 'Everyone', note: 'Thank you' }],
  refereeNotes: [],
  ...extra,
});

describe('safeCell', () => {
  it('prefixes text a spreadsheet would run as a formula', () => {
    expect(['=1+1', '+44', '-2', '@SUM(A1)', '\tx'].map((v) => safeCell(v))).toEqual(["'=1+1", "'+44", "'-2", "'@SUM(A1)", "'\tx"]);
  });

  it('leaves ordinary text and numbers alone, and blanks missing values', () => {
    expect(safeCell('Oak A')).toBe('Oak A');
    expect(safeCell(-3)).toBe(-3);
    expect(safeCell(null)).toBe('');
    expect(safeCell(undefined)).toBe('');
  });
});

describe('resultsBookToCsv', () => {
  it('includes the official reference only when supplied, safely escaped as spreadsheet text', () => {
    const data = book();
    expect(resultsBookToCsv(data)).not.toContain('Competition reference,');
    data.competition.competitionNumber = 'TEST-42';
    expect(resultsBookToCsv(data)).toContain('Competition reference,TEST-42');
    data.competition.competitionNumber = '=1+1';
    expect(resultsBookToCsv(data)).toContain("Competition reference,'=1+1");
    data.competition.competitionNumber = '  ';
    expect(resultsBookToCsv(data)).not.toContain('Competition reference,');
  });

  it('keeps missing venue, final labels and award notes blank', () => {
    const data = book();
    data.competition.location = null;
    data.sections[0].standings[0].finalLabel = null;
    data.eventAwards[0].note = null;
    const csv = resultsBookToCsv(data);
    expect(csv.split('\r\n')).toContain('Venue,');
    expect(csv).toContain('1,Oak A,"Oak, Pony Club",,30,6,3,0,');
    expect(csv).toContain('Spirit of the Games,Everyone,');
  });

  it('writes the event, each age group’s standings, its finals and awards, then the event awards', () => {
    const csv = resultsBookToCsv(book());
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Results book,Mounted Games');
    expect(lines).toContain('Event,Spring Games');
    expect(lines).toContain('Date,4 May 2031');
    expect(lines).toContain('Status,Final');
    expect(lines).toContain('Copy,Public');
    expect(lines).toContain('Under 12 Teams: final standings');
    expect(lines).toContain('Position,Team,Club,Final,Points,Races,Wins,Eliminations,Note');
    expect(lines).toContain('1,Oak A,"Oak, Pony Club",A Final,30,6,3,0,');
    expect(lines).toContain('Under 12 Teams: A Final (Finals)');
    expect(lines).toContain('Position,Team,Club,Bending,Mug,Points');
    expect(lines).toContain('2,Beech B,Beech,DNF,DNS,0');
    expect(lines).toContain('Under 12 Teams: special awards');
    expect(lines).toContain('Spirit of the Games,Everyone,Thank you');
  });

  it('defuses a team name that starts like a formula and says who withdrew', () => {
    const lines = resultsBookToCsv(book()).split('\r\n');
    expect(lines).toContain("2,\"'=HYPERLINK(\"\"x\"\")\",Beech,A Final,24,6,1,1,Withdrawn");
  });

  it('shows a bonus column only when some team has bonus points', () => {
    const withBonus = book();
    withBonus.sections[0].standings[0] = { ...withBonus.sections[0].standings[0], bonusPoints: 3 };
    expect(resultsBookToCsv(withBonus)).toContain('Position,Team,Club,Final,Points,of which bonus,Races,Wins,Eliminations,Note');
    expect(resultsBookToCsv(book())).not.toContain('of which bonus');
  });

  it('marks a provisional book, and leaves out an age group with no awards or finals cleanly', () => {
    const csv = resultsBookToCsv(book({ isProvisional: true, eventAwards: [], sections: [{ ...book().sections[0], finals: [], awards: [] }] }));
    expect(csv).toContain('Status,Provisional: some races are not complete');
    expect(csv).not.toContain('special awards');
    expect(csv).not.toContain('A Final (');
  });

  it('adds the referee’s notes only to the organiser copy', () => {
    const notes = [{ sectionName: 'Under 12 Teams', heatLabel: 'A Final', raceName: 'Bending', teamName: 'Beech B', statusLetter: 'DNF', note: 'Lost a shoe' }];
    const organiser = resultsBookToCsv(book({ includesPrivate: true, refereeNotes: notes }));
    expect(organiser).toContain('Copy,Organiser copy (includes private referee notes)');
    expect(organiser).toContain('Referee notes (private: do not publish)');
    expect(organiser).toContain('Under 12 Teams,A Final,Bending,Beech B,DNF,Lost a shoe');
    // A public book never prints notes, even if some were handed in by mistake.
    expect(resultsBookToCsv(book({ includesPrivate: false, refereeNotes: notes }))).not.toContain('Lost a shoe');
    // The organiser copy with no notes has no empty notes block.
    expect(resultsBookToCsv(book({ includesPrivate: true }))).not.toContain('Referee notes');
    expect(resultsBookToCsv(book({ includesPrivate: true, refereeNotes: [{ ...notes[0], statusLetter: null }] }))).toContain('Beech B,,Lost a shoe');
  });
});

describe('resultsBookFileName', () => {
  it('is safe for a file system and tells the organiser copy apart', () => {
    expect(resultsBookFileName(book())).toBe('Spring_Games_results_book.csv');
    expect(resultsBookFileName(book({ includesPrivate: true }))).toBe('Spring_Games_results_book_organiser.csv');
  });
});

describe('formatPublicResultsSummary and copyPublicResultsSummary (#300)', () => {
  it('formats podiums, finalists, awards, and protects useInitialOnly minors via publicRiderName', () => {
    const sample = book({
      includesPrivate: true,
      refereeNotes: [{ sectionName: 'Under 12 Teams', heatLabel: 'A Final', raceName: 'Bending', teamName: 'Beech B', statusLetter: 'DNF', note: 'Private vet note' }],
      sections: [{
        sectionId: 5,
        sectionName: 'Under 12 Teams',
        format: 2,
        standings: [
          { rank: 1, teamId: 1, teamName: 'Oak A', clubName: 'Oak Pony Club', finalLabel: 'A Final', totalPoints: 30, bonusPoints: 0, racesRun: 6, wins: 3, eliminations: 0, withdrawn: false },
          { rank: 2, teamId: 2, teamName: 'Beech B', clubName: 'Beech', finalLabel: 'A Final', totalPoints: 24.5, bonusPoints: 0, racesRun: 6, wins: 1, eliminations: 0, withdrawn: false },
          { rank: 3, teamId: 3, teamName: 'Elm', clubName: 'Elm', finalLabel: 'A Final', totalPoints: 1, bonusPoints: 0, racesRun: 6, wins: 0, eliminations: 0, withdrawn: false },
          { rank: 4, teamId: 4, teamName: 'Ash', clubName: 'Ash', finalLabel: 'A Final', totalPoints: 12, bonusPoints: 0, racesRun: 6, wins: 0, eliminations: 0, withdrawn: false },
          { rank: 5, teamId: 5, teamName: 'Withdrawn Team', clubName: 'Club', finalLabel: 'A Final', totalPoints: 20, bonusPoints: 0, racesRun: 2, wins: 1, eliminations: 0, withdrawn: true },
        ],
        finals: [],
        awards: [{ id: 1, competitionSectionId: 5, title: 'Best turned out', recipient: 'Oak A', note: 'Gleaming' }],
      }],
    });

    const summary = formatPublicResultsSummary(sample, {
      ridersByTeamId: {
        1: [
          { fullName: 'Oliver Smith', useInitialOnly: true, horseName: 'Biscuit' },
          { fullName: 'Ava Jones', useInitialOnly: false, horseName: 'Comet' },
          { fullName: '   ', useInitialOnly: false },
        ],
        2: [{ fullName: 'Leo Brown', useInitialOnly: true, horseName: null }],
      },
    });

    expect(summary).toContain('🏆 Spring Games · Oak Farm (4 May 2031)');
    expect(summary).toContain('── Under 12 Teams ──');
    expect(summary).toContain('🥇 1st: Oak A (Oak Pony Club) — A Final, 30 pts — Oliver S. (Biscuit), Ava Jones (Comet)');
    expect(summary).not.toContain('Oliver Smith');
    expect(summary).toContain('🥈 2nd: Beech B (Beech) — A Final, 24.5 pts — Leo B.');
    expect(summary).toContain('🥉 3rd: Elm — A Final, 1 pt');
    expect(summary).toContain('4th: Ash — A Final, 12 pts');
    expect(summary).not.toContain('Withdrawn Team');
    expect(summary).toContain('🎖️ Best turned out: Oak A (Gleaming)');
    expect(summary).toContain('── Special Awards ──');
    expect(summary).toContain('🎖️ Spirit of the Games: Everyone (Thank you)');
    expect(summary).not.toContain('Private vet note');
  });

  it('supports Map-based rider rosters, provisional books, non-final sections, and clipboard copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const sample = book({
      isProvisional: true,
      competition: { id: 2, name: 'Autumn Friendly', location: null, startDate: '2031-10-12T09:00:00Z', endDate: null },
      eventAwards: [],
      sections: [
        {
          sectionId: 1,
          sectionName: 'Empty Section',
          format: 2,
          standings: [],
          finals: [],
          awards: [],
        },
        {
          sectionId: 2,
          sectionName: 'Pairs',
          format: 1,
          standings: [
            { rank: 1, teamId: 10, teamName: 'Alpha Pair', clubName: 'Alpha Pair', finalLabel: null, totalPoints: 18, bonusPoints: 0, racesRun: 5, wins: 2, eliminations: 0, withdrawn: false },
          ],
          finals: [],
          awards: [{ id: 9, competitionSectionId: 2, title: 'Fastest Pair', recipient: 'Alpha Pair', note: null }],
        },
      ],
    });

    const map = new Map([[10, [{ fullName: 'Mia Clarke', useInitialOnly: true, horseName: 'Star' }]]]);
    const copied = await copyPublicResultsSummary(sample, { ridersByTeamId: map });
    expect(writeText).toHaveBeenCalledWith(copied);
    expect(copied).toContain('🏆 Autumn Friendly (12 October 2031)');
    expect(copied).toContain('(Provisional results)');
    expect(copied).not.toContain('Empty Section');
    expect(copied).toContain('🥇 1st: Alpha Pair — 18 pts — Mia C. (Star)');
    expect(copied).toContain('🎖️ Fastest Pair: Alpha Pair');
  });
});

