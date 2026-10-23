import { describe, expect, it } from 'vitest';
import type { ResultsBook } from '../pages/eventTools/resultsBookTypes';
import { resultsBookFileName, resultsBookToCsv, safeCell } from './resultsBookCsv';

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
