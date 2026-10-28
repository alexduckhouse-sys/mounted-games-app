import { Download } from 'lucide-react';
import { tr } from '../../i18n/translate';
import { downloadCsv } from '../../lib/csv';
import { resultsBookFileName, resultsBookToCsv } from '../../lib/resultsBookCsv';
import type { PrintableEntries, ResultsBook, SpecialAward } from './resultsBookTypes';
import { formatPoints } from '../../lib/formatPoints';
import { CopyResults } from './CopyResults';

function Awards({ awards }: { awards: SpecialAward[] }) {
  if (awards.length === 0) return null;
  return <div className="event-print-block">
    <h3>{tr('ops3.book.awards')}</h3>
    <ul className="event-print-awards">{awards.map((award) => <li key={award.id}>
      <strong>{award.title}</strong>: {award.recipient}{award.note ? <span className="event-print-note"> ({award.note})</span> : null}
    </li>)}</ul>
  </div>;
}

/** The post-event results book: each age group's final standings, its finals and awards. Print it, or download the CSV. */
export function ResultsBookView({ data }: { data: ResultsBook }) {
  return <>
    <div className="event-print-controls mb-4 flex flex-wrap gap-2">
      <button type="button" className="mg-btn mg-btn-secondary" onClick={() => downloadCsv(resultsBookFileName(data), resultsBookToCsv(data))}>
        <Download className="h-4 w-4" />{tr('ops2.tools.downloadCsv')}
      </button>
      <CopyResults book={data} />
    </div>
    {data.isProvisional && <p className="event-print-provisional">{tr('ops2.print.provisional')}</p>}
    {data.includesPrivate && <p className="event-print-provisional">{tr('ops3.book.organiserCopy')}</p>}
    {data.sections.length === 0 && <p className="event-print-empty">{tr('ops3.book.noGroups')}</p>}
    {data.sections.map((section) => <section key={section.sectionId} className="event-print-section event-print-break">
      <h2>{section.sectionName}</h2>
      {section.standings.length === 0 ? <p className="event-print-empty">{tr('ops2.print.noResults')}</p> : <StandingsTable standings={section.standings} />}
      {section.finals.map((final) => <div key={`${final.sessionName}:${final.label}`} className="event-print-block">
        <h3>{final.label} <span>{final.sessionName}</span></h3>
        <div className="event-print-table-wrap"><table>
          <thead><tr><th>{tr('ops2.print.colPos')}</th><th>{tr('ops2.print.team')}</th>{final.raceNames.map((name, index) => <th key={index} className="event-print-cell">{name}</th>)}<th className="event-print-cell">{tr('ops2.print.colPoints')}</th></tr></thead>
          <tbody>{final.rows.map((row) => <tr key={row.teamId}>
            <td>{row.rank}</td><td>{row.teamName}</td>
            {row.raceCells.map((cell, index) => <td key={index}>{cell}</td>)}<td><strong>{formatPoints(row.points)}</strong></td>
          </tr>)}</tbody>
        </table></div>
      </div>)}
      <Awards awards={section.awards} />
    </section>)}
    {data.eventAwards.length > 0 && <section className="event-print-section"><h2>{tr('ops3.book.eventAwards')}</h2><Awards awards={data.eventAwards} /></section>}
    {data.includesPrivate && data.refereeNotes.length > 0 && <section className="event-print-section event-print-private">
      <h2>{tr('ops3.book.refNotes')}</h2>
      <p className="event-print-note">{tr('ops3.book.orgOnly')}</p>
      <div className="event-print-table-wrap"><table>
        <thead><tr><th>{tr('ops3.book.ageGroup')}</th><th>{tr('ops3.book.heat')}</th><th>{tr('ops3.book.race')}</th><th>{tr('ops2.print.team')}</th><th>{tr('ops3.book.result')}</th><th>{tr('ops3.book.note')}</th></tr></thead>
        <tbody>{data.refereeNotes.map((note, index) => <tr key={index}>
          <td>{note.sectionName}</td><td>{note.heatLabel}</td><td>{note.raceName}</td><td>{note.teamName}</td><td>{note.statusLetter ?? ''}</td><td>{note.note}</td>
        </tr>)}</tbody>
      </table></div>
    </section>}
  </>;
}

function StandingsTable({ standings }: { standings: ResultsBook['sections'][number]['standings'] }) {
  const hasBonus = standings.some((row) => row.bonusPoints > 0);
  return <div className="event-print-table-wrap"><table>
    <thead><tr><th>{tr('ops2.print.colPos')}</th><th>{tr('ops2.print.team')}</th><th>{tr('ops3.book.final')}</th><th>{tr('ops2.print.colPoints')}</th>{hasBonus && <th>{tr('ops3.book.bonus')}</th>}<th>{tr('ops2.print.colRaces')}</th><th>{tr('ops2.print.colWins')}</th><th>{tr('ops2.print.colElim')}</th></tr></thead>
    <tbody>{standings.map((row) => <tr key={row.teamId}>
      <td>{row.rank}</td>
      <td>{row.teamName}{row.withdrawn ? <span className="event-print-note"> ({tr('ops3.withdrawn')})</span> : null}</td>
      <td>{row.finalLabel ?? ''}</td><td><strong>{formatPoints(row.totalPoints)}</strong></td>
      {hasBonus && <td>{row.bonusPoints}</td>}<td>{row.racesRun}</td><td>{row.wins}</td><td>{row.eliminations}</td>
    </tr>)}</tbody>
  </table></div>;
}

/** The pre-event entry list: every team with its riders and ponies, for checking before the day. */
export function EntriesView({ data }: { data: PrintableEntries }) {
  if (data.sections.length === 0) return <p className="event-print-empty">{tr('ops3.tackPrint.noGroups')}</p>;
  return <>{data.sections.map((section) => <section key={section.sectionId} className="event-print-section">
    <h2>{section.sectionName}</h2>
    {section.teams.length === 0 ? <p className="event-print-empty">{tr('ops3.tackPrint.noTeams')}</p> : section.teams.map((team) => <div key={team.teamId} className="event-print-block">
      <h3>{team.teamName} <span>{[team.bib, team.isHorsConcours ? 'HC' : null, team.withdrawn ? tr('ops3.withdrawn') : null].filter(Boolean).join(' · ')}</span></h3>
      {team.riders.length === 0 ? <p className="event-print-note">{tr('ops3.book.noRiders')}</p> : <div className="event-print-table-wrap"><table>
        <thead><tr><th>{tr('ops3.rider')}</th><th>{tr('ops3.pony')}</th><th>{tr('ops3.book.role')}</th></tr></thead>
        <tbody>{team.riders.map((rider, index) => <tr key={index}>
          <td>{rider.name}</td><td>{rider.pony ?? ''}</td>
          <td>{[rider.isCaptain ? tr('ops3.book.captain') : null, rider.isReserve ? tr('ops3.book.reserve') : null, rider.isGuest ? tr('ops3.book.guest') : null].filter(Boolean).join(', ')}</td>
        </tr>)}</tbody>
      </table></div>}
    </div>)}
  </section>)}</>;
}
