import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, Printer } from 'lucide-react';
import { api } from '../../api';
import type { PrintableDraw, PrintableResults, PrintableScoreSheets } from './eventToolsTypes';
import { PosterPage } from './PosterPage';
import { statusLetter } from '../../lib/resultStatus';
import './printEvent.css';

type View = 'draw' | 'score-sheets' | 'results';

function date(value: string) {
  return new Date(value).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
}

function time(value: string | null) {
  return value ? new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'Time TBC';
}

function message(error: unknown) {
  const candidate = error as { response?: { data?: { detail?: string; title?: string } } };
  return candidate.response?.data?.detail ?? candidate.response?.data?.title ?? 'Couldn’t load this print view.';
}

export default function PrintEventPage() {
  const { competitionId = '', view: rawView = 'draw' } = useParams();
  if (rawView === 'poster') return <PosterPage key={competitionId} competitionId={competitionId} />;
  const view = (['draw', 'score-sheets', 'results'].includes(rawView) ? rawView : 'draw') as View;
  return <PrintView key={`${competitionId}:${view}`} competitionId={competitionId} view={view} />;
}

function PrintView({ competitionId, view }: { competitionId: string; view: View }) {
  const [data, setData] = useState<PrintableDraw | PrintableScoreSheets | PrintableResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.get(`/event-tools/competitions/${competitionId}/print/${view}`)
      .then((response) => { if (!cancelled) setData(response.data); })
      .catch((caught) => { if (!cancelled) setError(message(caught)); });
    return () => { cancelled = true; };
  }, [competitionId, view, attempt]);

  if (error) return <div className="mg-card p-4" role="alert">{error} <button className="mg-btn mg-btn-secondary" onClick={() => { setError(null); setAttempt(attempt + 1); }}>Try again</button></div>;
  if (!data) return <p className="mg-card p-4" role="status">Preparing the print view…</p>;
  const competition = data.competition;

  return (
    <article className="event-print-page">
      <div className="event-print-controls mb-5 flex flex-wrap gap-2">
        <Link className="mg-btn mg-btn-secondary" to={`/competitions/${competitionId}/details`}><ChevronLeft className="h-4 w-4" />Event details</Link>
        <button className="mg-btn mg-btn-primary" onClick={() => window.print()}><Printer className="h-4 w-4" />Print</button>
      </div>
      <header className="event-print-header">
        <p className="event-print-kicker">Mounted Games</p>
        <h1>{competition.name}</h1>
        <p>{date(competition.startDate)}{competition.location ? ` · ${competition.location}` : ''}</p>
        <p className="event-print-kind">{view === 'draw' ? 'Draw and lanes' : view === 'score-sheets' ? 'Score sheets' : 'Results'}</p>
      </header>

      {view === 'draw' && <Draw data={data as PrintableDraw} />}
      {view === 'score-sheets' && <ScoreSheets data={data as PrintableScoreSheets} />}
      {view === 'results' && <Results data={data as PrintableResults} />}
    </article>
  );
}

function Draw({ data }: { data: PrintableDraw }) {
  if (data.sessions.length === 0) return <p className="event-print-empty">No draw has been set up yet.</p>;
  return <>{data.sessions.map((session) => <section key={session.sessionId} className="event-print-section"><h2>{session.sectionName || 'Open section'} · {session.sessionName}</h2>{session.arenaName && <p className="event-print-note">Arena: {session.arenaName}</p>}{session.heats.map((heat) => <div key={heat.heatId} className="event-print-block"><h3>{heat.label} <span>{time(heat.scheduledStart)}</span></h3><div className="event-print-table-wrap"><table><thead><tr><th>Lane</th><th>Team</th><th>Club</th><th>Races</th></tr></thead><tbody>{heat.teams.map((team, index) => <tr key={team.teamId}><td>{team.lane}</td><td>{team.teamName}</td><td>{team.clubName}</td>{index === 0 && <td rowSpan={Math.max(heat.teams.length, 1)}>{heat.races.map((race) => race.name).join(', ') || 'No races added'}</td>}</tr>)}</tbody></table></div></div>)}</section>)}</>;
}

/** A recorded result as it is written on the sheet: points, E, DNS, DNF or R for a team that did not finish, "S" for a sit-out, nothing if the race isn't scored. */
function scoreText(cell: { points: number | null; eliminated: boolean; isSitOut?: boolean; status?: number } | undefined): string {
  if (!cell) return '';
  if (cell.isSitOut) return 'S';
  if (cell.eliminated) return statusLetter(true, cell.status) ?? 'E';
  return cell.points === null || cell.points === undefined ? '' : String(cell.points);
}

function ScoreSheets({ data }: { data: PrintableScoreSheets }) {
  if (data.heats.length === 0) return <p className="event-print-empty">No score sheets are available yet.</p>;
  return <>{data.heats.map((heat) => {
    // One row per team in lane order, one column per race; anything already scored is filled in.
    const teams = (heat.races[0]?.teams ?? []).slice().sort((a, b) => (a.lane ?? 0) - (b.lane ?? 0));
    return <section key={heat.heatId} className="event-print-section event-print-break">
      <h2>{heat.sectionName || 'Open section'} · {heat.sessionName} · {heat.label}</h2>
      <p className="event-print-note">{time(heat.scheduledStart)}</p>
      {heat.races.length === 0 ? <p className="event-print-empty">No races have been added to this heat.</p> : <div className="event-print-table-wrap"><table>
        <thead><tr><th>Lane</th><th>Team</th><th>Bib</th>{heat.races.map((race, index) => <th key={race.raceId} className="event-print-cell">{index + 1}. {race.name}</th>)}<th className="event-print-cell">Total</th></tr></thead>
        <tbody>{teams.map((team) => {
          const cells = heat.races.map((race) => race.teams.find((x) => x.teamId === team.teamId));
          const scored = cells.filter((cell) => cell && cell.points !== null && cell.points !== undefined);
          return <tr key={team.teamId}>
            <td>{team.lane || ''}</td><td>{team.teamName}</td><td>{team.bib ?? ''}</td>
            {cells.map((cell, index) => <td key={heat.races[index].raceId}>{scoreText(cell)}</td>)}
            <td>{scored.length > 0 ? scored.reduce((sum, cell) => sum + (cell!.points ?? 0), 0) : ''}</td>
          </tr>;
        })}</tbody>
      </table></div>}
    </section>;
  })}</>;
}

function Results({ data }: { data: PrintableResults }) {
  return <>{data.isProvisional && <p className="event-print-provisional">Provisional results: some races are not complete.</p>}{data.sections.length === 0 ? <p className="event-print-empty">No sections are available yet.</p> : data.sections.map((section) => <section key={section.competitionSectionId} className="event-print-section"><h2>{section.sectionName}</h2>{section.results.length === 0 ? <p className="event-print-empty">No results yet.</p> : <div className="event-print-table-wrap"><table><thead><tr><th>Pos.</th><th>Team</th><th>Club</th><th>Points</th><th>Races</th><th>Wins</th><th>Elim.</th></tr></thead><tbody>{section.results.map((row) => <tr key={row.teamId}><td>{row.rank}</td><td>{row.teamName}</td><td>{row.clubName}</td><td><strong>{row.totalPoints}</strong></td><td>{row.racesRun}</td><td>{row.wins}</td><td>{row.eliminations}</td></tr>)}</tbody></table></div>}</section>)}</>;
}
