import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCompetition } from './context';
import type { Heat, Session } from '../../types';
import { computeTimings, formatTime } from '../../lib/time';
import { displaySectionName } from '../../lib/section';
import { statusLabel, timetableRows } from '../../lib/timetableRows';
import './heat.css';

interface Cell { points: number; eliminated: boolean }

/** The public heat page: who is racing, the score for every race so far and the running total. */
export function HeatScores({ session, heats, activeHeatId }: { session: Session; heats: Heat[]; activeHeatId: number | null }) {
  const { competition } = useCompetition();
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
  const time = row?.effective ? formatTime(row.effective) : null;
  const metaTail = status === 'live' && runningIndex >= 0 ? `Race ${runningIndex + 1} of ${races.length}` : session.arenaName?.trim();
  const meta = [time, metaTail].filter(Boolean).join(' · ');

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

  const badgeStyle = 'inline-flex h-[26px] items-center gap-[5px] rounded-md px-2.5 text-xs font-bold leading-none tracking-[0.04em]';
  const badge = status === 'live' ? <span className={`mg-badge mg-badge-live !h-[26px] !px-2.5 !text-xs`}>On now</span>
    : finished ? <span className={`${badgeStyle} bg-[rgb(var(--mg-tint))] uppercase text-[rgb(var(--mg-heading))]`}>Finished</span>
    : status === 'late' && row ? <span className="mg-badge mg-badge-late !h-[26px] !px-2.5 !text-xs">{statusLabel(status, row.delayMinutes)}</span>
    : null;
  const minWidth = 12 + (finished ? 18 : 0) + 96 + races.length * 23 + 44;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <header className="mg-band flex flex-col gap-2.5 pb-3.5 pt-2.5">
        <div className="flex items-center gap-2.5">
          <Link to={`/competitions/${competition.id}`} className="mg-text-link -ml-1 !min-h-[44px] !justify-start !gap-1 pl-1 pr-2.5 !text-sm"><ChevronLeft aria-hidden="true" className="h-[18px] w-[18px]" />Timetable</Link>
          <span className="flex-1" />
          {badge}
        </div>
        <div className="flex items-baseline gap-2.5">
          <h1 className="mg-display shrink-0 text-[28px] font-bold leading-none text-[rgb(var(--mg-heading))]">{heat ? `${section ? `${section} · ` : ''}${heatLabel}` : heatLabel}</h1>
          {meta && <span className="min-w-0 text-[13px] font-medium leading-none text-[rgb(var(--mg-muted))]">{meta}</span>}
        </div>
      </header>

      {!heat ? <p className="mg-card p-4 text-[rgb(var(--mg-muted))]">No heats in this session yet.</p> : (
        <section aria-label="Scores" className="mg-card overflow-hidden">
          {grid.teams.length === 0 ? <p className="p-4 text-[rgb(var(--mg-muted))]">No teams in this heat yet.</p> : (
            <div className="overflow-x-auto">
              <table className="heat-grid" style={{ minWidth }}>
                <thead>
                  <tr>
                    {finished && <th scope="col" className="heat-rank">#</th>}
                    <th scope="col">Team</th>
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
          {competition.streamUrl && <Link to={`/competitions/${competition.id}/chat`} className="mg-btn mg-btn-primary flex-1">Watch stream</Link>}
          {session.competitionSectionId != null && <Link to={`/competitions/${competition.id}/toplists?section=${session.competitionSectionId}`} className={`mg-btn flex-1 ${competition.streamUrl ? 'mg-btn-secondary' : 'mg-btn-primary'}`}>{section ? `${section} toplist` : 'Toplist'}</Link>}
        </div>
      )}
    </div>
  );
}
