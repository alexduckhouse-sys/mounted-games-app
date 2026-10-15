import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { computeTimings, formatTime } from '../../lib/time';
import { displaySectionName } from '../../lib/section';
import { timetableRows } from '../../lib/timetableRows';
import { TimetableEvent } from './TimetableBoard';

/** "When is my team in?": type a team name, see every heat it rides in with live times and status. */
export function TeamFinder({ autoFocus = false }: { autoFocus?: boolean }) {
  const { competition } = useCompetition();
  const { canOrganise } = useAuth();
  const [pickedId, setPickedId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const teams = useMemo(() => competition.teams.slice().sort((a, b) => a.displayName.localeCompare(b.displayName)), [competition.teams]);
  const search = query.trim().toLowerCase();
  const matches = search && pickedId == null ? teams.filter((team) => team.displayName.toLowerCase().includes(search)).slice(0, 8) : [];
  const team = teams.find((item) => item.id === pickedId) ?? null;
  const showQualifiers = canOrganise();
  const rows = useMemo(() => {
    if (pickedId == null) return [];
    const timings = computeTimings(competition.sessions);
    return timetableRows(competition.sessions, timings, showQualifiers).filter((row) => row.heat?.entries.some((entry) => entry.teamId === pickedId));
  }, [pickedId, competition.sessions, showQualifiers]);
  const next = rows.find((row) => row.status !== 'finished') ?? null;

  return (
    <section aria-label="Find my team's heats" className="mg-card flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <label className="mg-field min-w-0 flex-1">
          <Search aria-hidden="true" className="h-[18px] w-[18px] shrink-0" />
          <span className="sr-only">Team name</span>
          <input autoFocus={autoFocus} type="search" placeholder="Type your team's name" value={query} onChange={(e) => { setQuery(e.target.value); setPickedId(null); }} />
        </label>
        {(pickedId != null || query) && <button type="button" className="mg-icon-btn" aria-label="Clear team search" onClick={() => { setPickedId(null); setQuery(''); }}><X className="h-5 w-5" /></button>}
      </div>
      {matches.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Matching teams">
          {matches.map((item) => <button key={item.id} type="button" className="mg-chip" onClick={() => { setPickedId(item.id); setQuery(item.displayName); }}>{item.displayName}</button>)}
        </div>
      )}
      {search && pickedId == null && matches.length === 0 && <p className="mg-meta">No team matches “{query.trim()}”.</p>}
      {team && (
        <div className="flex flex-col gap-2.5" role="status">
          <div className="flex flex-col gap-1">
            <h3 className="mg-h2">{team.displayName}</h3>
            <p className="mg-meta">
              {next ? `Next up ${formatTime(next.effective)} · ${next.heat?.label || `Heat ${next.heatIndex + 1}`}` : rows.length > 0 ? 'All heats finished.' : 'Not in any heats yet.'}
            </p>
          </div>
          {rows.length > 0 && (
            <div className="mg-card mg-list">
              {rows.map((row) => <TimetableEvent key={row.key} row={row} competitionId={competition.id} showArena detail={displaySectionName(row.session.sectionName || row.session.name)} />)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
