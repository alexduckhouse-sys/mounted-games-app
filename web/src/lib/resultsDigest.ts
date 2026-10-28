import { tr } from '../i18n/translate';
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
      ? [tr('ops3.digest.ref', { ref: line(book.competition.competitionNumber) })] : []),
    book.isProvisional ? tr('ops3.digest.provisional') : tr('ops3.digest.final'),
  ];
  const blocks = [header.join('\n')];
  for (const section of book.sections) {
    blocks.push([
      line(section.sectionName),
      ...(section.standings.length ? section.standings.map((row) =>
        `${row.rank}. ${line(row.teamName)} · ${tr('ops3.digest.pts', { points: formatPoints(row.totalPoints) })}${row.finalLabel ? ` · ${line(row.finalLabel)}` : ''}${row.withdrawn ? ` (${tr('ops3.withdrawn')})` : ''}`,
      ) : [tr('ops2.print.noResults')]),
      ...section.awards.map((award) => `${line(award.title)}: ${line(award.recipient)}`),
    ].join('\n'));
  }
  if (book.sections.length === 0) blocks.push(tr('ops2.print.noResults'));
  if (book.eventAwards.length) {
    blocks.push(book.eventAwards.map((award) => `${line(award.title)}: ${line(award.recipient)}`).join('\n'));
  }
  return blocks.join('\n\n');
}
