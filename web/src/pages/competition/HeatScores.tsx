import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useCompetition } from './context';
import type { Heat, Session } from '../../types';
import { computeTimings } from '../../lib/time';
import { displaySectionName } from '../../lib/section';
import { timetableRows } from '../../lib/timetableRows';
import { useCompactPageBar } from '../../components/CompactPageBarContext';
import './heat.css';

interface Cell { points: number; eliminated: boolean }

/** The public heat page: who is racing, the score for every race so far and the running total. */
export function HeatScores({ session, heats, activeHeatId }: { session: Session; heats: Heat[]; activeHeatId: number | null }) {
  const { competition, streams } = useCompetition();
  const canWatch = !!competition.streamUrl || streams.some((stream) => stream.status !== 2);
  // The page can be reached with ?heat=<id> while already mounted (next-heat link), so the URL wins over the parent's initial pick.
  const [searchParams] = useSearchParams();
  const requestedHeat = Number(searchParams.get('heat'));
  const shownHeatId = heats.some((item) => item.id === requestedHeat) ? requestedHeat : activeHeatId;
  const index = Math.max(0, heats.findIndex((item) => item.id === shownHeatId));
  const heat = heats[index] ?? null;
  const nextHeat = heats[index + 1] ?? null;
  const row = useMemo(() => {
    if (!heat) return null;
    return timetableRows(competition.sessions, computeTimings(competition.sessions), true).find((item) => item.heat?.id === heat.id) ?? null;
  }, [competition.sessions, heat]);
  const section = displaySectionName(session.sectionName || session.name);
  const heatLabel = heat ? heat.label || `Heat ${index + 1}` : session.name;
  const races = useMemo(() => (heat?.races ?? []).slice().sort((a, b) => a.orderIndex - b.orderIndex), [heat]);
  const status = row?.status ?? 'on-time';
  const finished = status === 'finished';
  const runningIndex = status === 'live' ? races.findIndex((race) => !race.isComplete) : -1;
  const time = row?.effective ? row.effective.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null;
  const runningRace = runningIndex >= 0 ? races[runningIndex] : null;
  const tableMeta = status === 'live' && runningRace
    ? `Race ${runningIndex + 1} of ${races.length} · ${runningRace.name}`
    : finished
      ? [time, 'Final result'].filter(Boolean).join(' · ')
      : time ? `Starts ${time}${status === 'late' && row ? ` · running ${row.delayMinutes} min late` : ''}` : 'Start time to be confirmed';
  const compactSubtitle = [section ? `${section} heats` : 'Heats', session.arenaName?.trim()].filter(Boolean).join(' · ');
  useCompactPageBar({
    backTo: `/competitions/${competition.id}`,
    title: competition.name,
    subtitle: compactSubtitle,
    badge: status === 'live' ? 'live' : finished ? 'finished' : 'next',
  });

  const grid = useMemo(() => {
    if (!heat) return { teams: [], cells: new Map<string, Cell>() };
    const teams = new Map<number, { id: number; name: string; lane: number }>();
    for (const entry of heat.entries.slice().sort((a, b) => a.laneIndex - b.laneIndex)) {
      teams.set(entry.teamId, { id: entry.teamId, name: entry.teamName, lane: entry.laneIndex });
    }
    const cells = new Map<string, Cell>();
    for (const race of races) {
      for (const result of race.results) {
        if (!teams.has(result.teamId)) teams.set(result.teamId, { id: result.teamId, name: result.teamName, lane: Number.MAX_SAFE_INTEGER });
        const key = `${result.teamId}|${race.id}`;
        const cell = cells.get(key) ?? { points: 0, eliminated: false };
        cell.points += result.points;
        if (result.eliminated && result.points === 0) cell.eliminated = true;
        cells.set(key, cell);
      }
    }
    const list = [...teams.values()].map((team) => ({ ...team, total: races.reduce((sum, race) => sum + (cells.get(`${team.id}|${race.id}`)?.points ?? 0), 0) }));
    // Lane order while the heat is on; once it is finished the leader goes first and each row shows its position.
    list.sort((a, b) => (finished ? b.total - a.total : 0) || a.lane - b.lane || a.name.localeCompare(b.name));
    const ranked = list.map((team, i) => ({ ...team, position: finished ? 1 + list.findIndex((other) => other.total === team.total) : i + 1 }));
    return { teams: ranked, cells };
  }, [heat, races, finished]);

  const minWidth = 12 + (finished ? 18 : 0) + 116 + races.length * 23 + 44;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <h1 className="sr-only">{section ? `${section} ${heatLabel} scores` : `${heatLabel} scores`}</h1>

      {!heat ? <p className="mg-card p-4 text-[rgb(var(--mg-muted))]">No heats in this session yet.</p> : (
        <section aria-label="Scores" className="mg-card overflow-hidden">
          {grid.teams.length === 0 ? <p className="p-4 text-[rgb(var(--mg-muted))]">No teams in this heat yet.</p> : (
            <div className="overflow-x-auto">
              <table className="heat-grid" style={{ minWidth }}>
                <thead>
                  <tr>
                    {finished && <th scope="col" className="heat-rank">#</th>}
                    <th scope="col" className="heat-team-head">
                      <div className="heat-title">
                        {section && <span className="heat-title-section">{section}</span>}
                        <span className="heat-title-name">{heatLabel}</span>
                        <span className={`heat-title-meta ${status === 'live' ? 'heat-title-meta-live' : status === 'late' ? 'heat-title-meta-late' : ''}`}>{tableMeta}</span>
                      </div>
                      <span>Team</span>
                    </th>
                    {races.map((race, i) => (
                      <th key={race.id} scope="col" className="heat-race" title={race.name}>
                        {i > 0 && <span aria-hidden="true" className="heat-sep" />}
                        <span className={`heat-name ${i === runningIndex ? 'heat-name-running' : ''}`}>{race.name}{i === runningIndex && <span className="sr-only"> (running)</span>}</span>
                      </th>
                    ))}
                    <th scope="col" className="heat-pts">
                      {races.length > 0 && <span aria-hidden="true" className="heat-sep" />}
                      Pts
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {grid.teams.map((team) => (
                    <tr key={team.id}>
                      {finished && <td className="heat-rank-cell"><span className="sr-only">Position </span>{team.position}</td>}
                      <th scope="row" className="heat-team" title={team.name}>{team.name}</th>
                      {races.map((race, i) => {
                        const cell = grid.cells.get(`${team.id}|${race.id}`);
                        return <td key={race.id} className={`heat-cell ${i === 0 ? 'heat-cell-first' : ''}`}>
                          {cell == null ? <><span aria-hidden="true" className="heat-dash">–</span><span className="sr-only">Not raced yet</span></>
                            : cell.eliminated ? <><span aria-hidden="true" className="heat-elim">0</span><span className="sr-only">Eliminated</span></>
                            : cell.points}
                        </td>;
                      })}
                      <td className="heat-total">{team.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {finished ? (
        <div className="grid grid-cols-2 gap-2.5">
          {session.competitionSectionId != null && <Link to={`/competitions/${competition.id}/toplists?section=${session.competitionSectionId}`} className="mg-btn mg-btn-primary">Toplist</Link>}
          {nextHeat
            ? <Link to={`/competitions/${competition.id}/session/${session.id}?heat=${nextHeat.id}`} className="mg-btn mg-btn-secondary">{nextHeat.label || `Heat ${index + 2}`}<ChevronRight aria-hidden="true" className="h-4 w-4" /></Link>
            : <Link to={`/competitions/${competition.id}`} className="mg-btn mg-btn-secondary">Timetable</Link>}
        </div>
      ) : (
        <div className="flex gap-2.5">
          {canWatch && <Link to={`/competitions/${competition.id}/chat`} className="mg-btn mg-btn-primary flex-1">Watch stream</Link>}
          {session.competitionSectionId != null && <Link to={`/competitions/${competition.id}/toplists?section=${session.competitionSectionId}`} className={`mg-btn flex-1 ${canWatch ? 'mg-btn-secondary' : 'mg-btn-primary'}`}>{section ? `${section} toplist` : 'Toplist'}</Link>}
        </div>
      )}
    </div>
  );
}
