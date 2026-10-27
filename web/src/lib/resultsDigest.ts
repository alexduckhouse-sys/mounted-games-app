import type { ResultsBook } from '../pages/eventTools/resultsBookTypes';
import { formatPoints } from './formatPoints';

const line = (value: string) => value.replace(/\s+/g, ' ').trim();

/**
 * Plain text for sharing from the public results book. Refuse the organiser's copy and select only
 * public standing and award fields; referee notes and declared rider details never enter the text.
 * The server's order, shared ranks, final labels and provisional state remain authoritative.
 */
export function resultsDigest(book: ResultsBook): string {
  if (book.includesPrivate) throw new Error('Use the public results book for sharing.');
  const header = [
    line(book.competition.name),
    ...(book.competition.competitionNumber?.trim()
      ? [`Competition reference: ${line(book.competition.competitionNumber)}`] : []),
    book.isProvisional ? 'Provisional results' : 'Final results',
  ];
  const blocks = [header.join('\n')];
  for (const section of book.sections) {
    blocks.push([
      line(section.sectionName),
      ...(section.standings.length ? section.standings.map((row) =>
        `${row.rank}. ${line(row.teamName)} · ${formatPoints(row.totalPoints)} pts${row.finalLabel ? ` · ${line(row.finalLabel)}` : ''}${row.withdrawn ? ' (withdrawn)' : ''}`,
      ) : ['No results yet.']),
      ...section.awards.map((award) => `${line(award.title)}: ${line(award.recipient)}`),
    ].join('\n'));
  }
  if (book.sections.length === 0) blocks.push('No results yet.');
  if (book.eventAwards.length) {
    blocks.push(book.eventAwards.map((award) => `${line(award.title)}: ${line(award.recipient)}`).join('\n'));
  }
  return blocks.join('\n\n');
}
