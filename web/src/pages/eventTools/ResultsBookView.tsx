import { Download } from 'lucide-react';
import { downloadCsv } from '../../lib/csv';
import { resultsBookFileName, resultsBookToCsv } from '../../lib/resultsBookCsv';
import type { PrintableEntries, ResultsBook, SpecialAward } from './resultsBookTypes';

function Awards({ awards }: { awards: SpecialAward[] }) {
  if (awards.length === 0) return null;
  return <div className="event-print-block">
    <h3>Special awards</h3>
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
        <Download className="h-4 w-4" />Download CSV
      </button>
    </div>
    {data.isProvisional && <p className="event-print-provisional">Provisional results: some races are not complete.</p>}
    {data.includesPrivate && <p className="event-print-provisional">Organiser copy: this includes private referee notes. Print the public book for competitors.</p>}
    {data.sections.length === 0 && <p className="event-print-empty">No age groups are available yet.</p>}
    {data.sections.map((section) => <section key={section.sectionId} className="event-print-section event-print-break">
      <h2>{section.sectionName}</h2>
      {section.standings.length === 0 ? <p className="event-print-empty">No results yet.</p> : <StandingsTable standings={section.standings} />}
      {section.finals.map((final) => <div key={`${final.sessionName}:${final.label}`} className="event-print-block">
        <h3>{final.label} <span>{final.sessionName}</span></h3>
        <div className="event-print-table-wrap"><table>
          <thead><tr><th>Pos.</th><th>Team</th><th>Club</th>{final.raceNames.map((name, index) => <th key={index} className="event-print-cell">{name}</th>)}<th className="event-print-cell">Points</th></tr></thead>
          <tbody>{final.rows.map((row) => <tr key={row.teamId}>
            <td>{row.rank}</td><td>{row.teamName}</td><td>{row.clubName}</td>
            {row.raceCells.map((cell, index) => <td key={index}>{cell}</td>)}<td><strong>{row.points}</strong></td>
          </tr>)}</tbody>
        </table></div>
      </div>)}
      <Awards awards={section.awards} />
    </section>)}
    {data.eventAwards.length > 0 && <section className="event-print-section"><h2>Event awards</h2><Awards awards={data.eventAwards} /></section>}
    {data.includesPrivate && data.refereeNotes.length > 0 && <section className="event-print-section event-print-private">
      <h2>Referee notes (private)</h2>
      <p className="event-print-note">For organisers only. These are never part of the public results.</p>
      <div className="event-print-table-wrap"><table>
        <thead><tr><th>Age group</th><th>Heat</th><th>Race</th><th>Team</th><th>Result</th><th>Note</th></tr></thead>
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
    <thead><tr><th>Pos.</th><th>Team</th><th>Club</th><th>Final</th><th>Points</th>{hasBonus && <th>Bonus</th>}<th>Races</th><th>Wins</th><th>Elim.</th></tr></thead>
    <tbody>{standings.map((row) => <tr key={row.teamId}>
      <td>{row.rank}</td>
      <td>{row.teamName}{row.withdrawn ? <span className="event-print-note"> (withdrawn)</span> : null}</td>
      <td>{row.clubName}</td><td>{row.finalLabel ?? ''}</td><td><strong>{row.totalPoints}</strong></td>
      {hasBonus && <td>{row.bonusPoints}</td>}<td>{row.racesRun}</td><td>{row.wins}</td><td>{row.eliminations}</td>
    </tr>)}</tbody>
  </table></div>;
}

/** The pre-event entry list: every team with its riders and ponies, for checking before the day. */
export function EntriesView({ data }: { data: PrintableEntries }) {
  if (data.sections.length === 0) return <p className="event-print-empty">No age groups have been set up yet.</p>;
  return <>{data.sections.map((section) => <section key={section.sectionId} className="event-print-section">
    <h2>{section.sectionName}</h2>
    {section.teams.length === 0 ? <p className="event-print-empty">No teams entered yet.</p> : section.teams.map((team) => <div key={team.teamId} className="event-print-block">
      <h3>{team.teamName} <span>{[team.clubName, team.bib].filter(Boolean).join(' · ')}{team.isHorsConcours ? ' · HC' : ''}{team.withdrawn ? ' · withdrawn' : ''}</span></h3>
      {team.riders.length === 0 ? <p className="event-print-note">No riders declared yet.</p> : <div className="event-print-table-wrap"><table>
        <thead><tr><th>Rider</th><th>Pony</th><th>Role</th></tr></thead>
        <tbody>{team.riders.map((rider, index) => <tr key={index}>
          <td>{rider.name}</td><td>{rider.pony ?? ''}</td>
          <td>{[rider.isCaptain ? 'Captain' : null, rider.isReserve ? 'Reserve' : null, rider.isGuest ? 'Guest' : null].filter(Boolean).join(', ')}</td>
        </tr>)}</tbody>
      </table></div>}
    </div>)}
  </section>)}</>;
}
