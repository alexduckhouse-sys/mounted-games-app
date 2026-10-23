import type { ResultsBook } from '../pages/eventTools/resultsBookTypes';
import { safeFilename, toCsv } from './csv';

/**
 * A spreadsheet runs a cell that starts with =, +, - or @ as a formula, and team names are typed by
 * entrants. Text is therefore written with a leading apostrophe when it starts that way.
 */
export function safeCell(value: string | number | null | undefined): string | number {
  if (value == null) return '';
  if (typeof value === 'number') return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

const row = (cells: ReadonlyArray<string | number | null | undefined>) => cells.map(safeCell);

function longDate(value: string): string {
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * The results book as one CSV file: a few lines about the event, then for each age group its final
 * standings, each final, and its special awards, then the event-wide awards. The organiser's copy ends
 * with the referee's private notes. Blocks are separated by a blank line.
 */
export function resultsBookToCsv(book: ResultsBook): string {
  const blocks: string[] = [];
  const add = (title: string, header: string[], rows: ReadonlyArray<ReadonlyArray<unknown>>) => {
    blocks.push([toCsv([title], []), toCsv(header, rows.map((r) => r.map((cell) => safeCell(cell as string | number | null | undefined))))].join('\r\n'));
  };

  blocks.push(toCsv(['Results book', 'Mounted Games'], [
    row(['Event', book.competition.name]),
    row(['Date', longDate(book.competition.startDate)]),
    row(['Venue', book.competition.location ?? '']),
    row(['Status', book.isProvisional ? 'Provisional: some races are not complete' : 'Final']),
    row(['Copy', book.includesPrivate ? 'Organiser copy (includes private referee notes)' : 'Public']),
  ]));

  for (const section of book.sections) {
    const hasBonus = section.standings.some((s) => s.bonusPoints > 0);
    add(`${section.sectionName}: final standings`,
      ['Position', 'Team', 'Club', 'Final', 'Points', ...(hasBonus ? ['of which bonus'] : []), 'Races', 'Wins', 'Eliminations', 'Note'],
      section.standings.map((s) => [s.rank, s.teamName, s.clubName, s.finalLabel ?? '', s.totalPoints, ...(hasBonus ? [s.bonusPoints] : []), s.racesRun, s.wins, s.eliminations, s.withdrawn ? 'Withdrawn' : '']));
    for (const final of section.finals) {
      add(`${section.sectionName}: ${final.label} (${final.sessionName})`,
        ['Position', 'Team', 'Club', ...final.raceNames, 'Points'],
        final.rows.map((r) => [r.rank, r.teamName, r.clubName, ...r.raceCells, r.points]));
    }
    if (section.awards.length > 0) {
      add(`${section.sectionName}: special awards`, ['Award', 'Recipient', 'Note'], section.awards.map((a) => [a.title, a.recipient, a.note ?? '']));
    }
  }
  if (book.eventAwards.length > 0) add('Special awards', ['Award', 'Recipient', 'Note'], book.eventAwards.map((a) => [a.title, a.recipient, a.note ?? '']));
  if (book.includesPrivate && book.refereeNotes.length > 0) {
    add('Referee notes (private: do not publish)', ['Age group', 'Heat', 'Race', 'Team', 'Result', 'Note'],
      book.refereeNotes.map((n) => [n.sectionName, n.heatLabel, n.raceName, n.teamName, n.statusLetter ?? '', n.note]));
  }
  return blocks.join('\r\n\r\n');
}

/** A file name for the download, e.g. "Spring_Games_results_book.csv" or "..._organiser.csv". */
export function resultsBookFileName(book: ResultsBook): string {
  return `${safeFilename(book.competition.name)}_results_book${book.includesPrivate ? '_organiser' : ''}.csv`;
}
