import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, Printer } from 'lucide-react';
import { api } from '../../api';
import type { PrintableDraw, PrintableResults, PrintableScoreSheets } from './eventToolsTypes';
import { PosterPage } from './PosterPage';
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

function ScoreSheets({ data }: { data: PrintableScoreSheets }) {
  if (data.heats.length === 0) return <p className="event-print-empty">No score sheets are available yet.</p>;
  return <>{data.heats.map((heat) => <section key={heat.heatId} className="event-print-section event-print-break"><h2>{heat.sectionName || 'Open section'} · {heat.sessionName} · {heat.label}</h2><p className="event-print-note">{time(heat.scheduledStart)}</p>{heat.races.map((race) => <div key={race.raceId} className="event-print-block"><h3>{race.name}</h3><div className="event-print-table-wrap"><table><thead><tr><th>Team</th><th className="event-print-cell">Place</th><th className="event-print-cell">Elim.</th><th className="event-print-cell">Points</th><th>Notes</th></tr></thead><tbody>{race.teams.map((team) => <tr key={team.teamId}><td>{team.teamName}</td><td /><td /><td /><td /></tr>)}</tbody></table></div></div>)}</section>)}</>;
}

function Results({ data }: { data: PrintableResults }) {
  return <>{data.isProvisional && <p className="event-print-provisional">Provisional results: some races are not complete.</p>}{data.sections.length === 0 ? <p className="event-print-empty">No sections are available yet.</p> : data.sections.map((section) => <section key={section.competitionSectionId} className="event-print-section"><h2>{section.sectionName}</h2>{section.results.length === 0 ? <p className="event-print-empty">No results yet.</p> : <div className="event-print-table-wrap"><table><thead><tr><th>Pos.</th><th>Team</th><th>Club</th><th>Points</th><th>Races</th><th>Wins</th><th>Elim.</th></tr></thead><tbody>{section.results.map((row) => <tr key={row.teamId}><td>{row.rank}</td><td>{row.teamName}</td><td>{row.clubName}</td><td><strong>{row.totalPoints}</strong></td><td>{row.racesRun}</td><td>{row.wins}</td><td>{row.eliminations}</td></tr>)}</tbody></table></div>}</section>)}</>;
}
