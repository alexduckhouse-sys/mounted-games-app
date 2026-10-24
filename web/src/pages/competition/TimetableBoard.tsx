import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, MapPin, Star, Users } from 'lucide-react';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { Dropdown } from '../../components/Dropdown';
import { usePageWidth } from '../../components/pageWidthState';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { SponsorStrip } from '../../components/SponsorStrip';
import { useFavourites } from '../../hooks/useFavourites';
import { computeTimings, formatTime } from '../../lib/time';
import { displaySectionName } from '../../lib/section';
import { dayKey, defaultTimetableDay } from '../../lib/timetableDay';
import { groupMaxDelay, isGroupFinished, sessionOrdinals, statusLabel, TIMETABLE_COLOURS, timetableRows, type TimetableRow, type TimetableStatus } from '../../lib/timetableRows';
import './timetable.css';

const STATUS_KEY: ReadonlyArray<[TimetableStatus, string]> = [['on-time', 'On time'], ['late', 'Late'], ['live', 'On now'], ['finished', 'Finished']];

/**
 * The public timetable: a compact day/arena strip under the app header, then one block per session and per
 * age group's finals. Finished blocks fold into one line below the active ones. The page title, competition
 * name, update time and refresh button live in the app header. `bandExtra`, `lead` and `footer` let a page add its own controls.
 */
export function TimetableBoard({ sectionId = null, title = 'Timetable', bandExtra, lead, footer }: {
  sectionId?: number | null;
  title?: string;
  bandExtra?: ReactNode;
  lead?: ReactNode;
  footer?: ReactNode;
} = {}) {
  usePageWidth('wide');
  const { competition, reload, updatedAt } = useCompetition();
  const { canOrganise } = useAuth();
  const favHook = useFavourites() as {
    favourites?: { competitionId: number; teamId: number }[];
    isTeamFav?: (compId: number, teamId: number) => boolean;
  };
  const isTeamFav = (teamId: number) =>
    typeof favHook.isTeamFav === 'function'
      ? favHook.isTeamFav(competition.id, teamId)
      : (favHook.favourites ?? []).some((f) => f.competitionId === competition.id && f.teamId === teamId);
  const timings = useMemo(() => computeTimings(competition.sessions), [competition.sessions]);
  const showQualifiers = canOrganise(competition);
  // A race session with no heats yet is the provisional timetable (an estimate from the creator): organisers see it,
  // the public sees sessions once heats exist.
  const rows = useMemo(
    () => timetableRows(competition.sessions, timings, showQualifiers)
      .filter((row) => sectionId == null || row.session.competitionSectionId === sectionId)
      .filter((row) => showQualifiers || !isProvisionalRow(row)),
    [competition.sessions, timings, showQualifiers, sectionId],
  );
  const ordinals = useMemo(() => sessionOrdinals(competition.sessions), [competition.sessions]);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const arenaKey = `mg.tt.arena.${competition.id}`;
  const [showFinished, setShowFinished] = useState(false);
  const [openDone, setOpenDone] = useState<ReadonlySet<string>>(new Set());
  const [arena, setArena] = useState(() => { try { return localStorage.getItem(arenaKey) ?? ''; } catch { return ''; } });
  const [teamFilter, setTeamFilter] = useState('');
  function chooseArena(name: string) {
    setArena(name);
    try { if (name) localStorage.setItem(arenaKey, name); else localStorage.removeItem(arenaKey); } catch { /* storage blocked */ }
  }
  function toggleDone(key: string) {
    setOpenDone((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }
  const today = dayKey(new Date());
  const startDay = dayKey(new Date(competition.startDate));
  const endDay = dayKey(new Date(competition.endDate ?? competition.startDate));
  const rowDay = (row: TimetableRow) => row.effective ? dayKey(row.effective) : startDay;
  const days = [...new Set([startDay, ...rows.map(rowDay)])].filter(Boolean).sort();
  const cursor = new Date(`${startDay}T12:00:00`);
  for (let count = 0; count < 366 && dayKey(cursor) <= endDay; count += 1) {
    const day = dayKey(cursor);
    if (day && !days.includes(day)) days.push(day);
    cursor.setDate(cursor.getDate() + 1);
  }
  days.sort();
  const selectedDay = pickedDay && days.includes(pickedDay) ? pickedDay : defaultTimetableDay(days, today);
  const dayRows = rows.filter((row) => rowDay(row) === selectedDay);
  const arenas = [...new Set(dayRows.map((row) => row.session.arenaName?.trim()).filter((name): name is string => !!name))];
  const selectedArena = arenas.includes(arena) ? arena : '';
  const teamsInDay = dayTeams(dayRows);
  const selectedTeam = teamsInDay.some((t) => String(t.id) === teamFilter) ? teamFilter : '';
  const selectedTeamId = selectedTeam ? Number(selectedTeam) : null;
  const visibleRows = dayRows
    .filter((row) => !selectedArena || row.session.arenaName?.trim() === selectedArena || !row.session.arenaName?.trim())
    .filter((row) => selectedTeamId == null || row.heat?.entries.some((e) => e.teamId === selectedTeamId));

  const sessionGroups = (() => {
    const bySession = new Map<number, { key: string; session: TimetableRow['session']; race: boolean; rows: TimetableRow[] }>();
    for (const row of visibleRows.filter((item) => item.group === 'Heats')) {
      const existing = bySession.get(row.session.id);
      if (existing) {
        existing.rows.push(row);
      } else {
        const race = (row.session.kind ?? (row.session.isBreak ? 1 : 0)) === 0;
        bySession.set(row.session.id, {
          key: `session-${row.session.id}`,
          session: row.session,
          race,
          rows: [row],
        });
      }
    }
    return [...bySession.values()]
      .sort((a, b) => {
        const aStart = (a.rows[0]?.effective ?? a.rows[0]?.scheduled)?.getTime() ?? Infinity;
        const bStart = (b.rows[0]?.effective ?? b.rows[0]?.scheduled)?.getTime() ?? Infinity;
        return aStart - bStart || a.session.orderIndex - b.session.orderIndex || a.session.id - b.session.id;
      })
      .map((group) => ({
        key: group.key,
        title: group.race ? `${displaySectionName(group.session.sectionName || group.session.name)} · Session ${ordinals.get(group.session.id) ?? 1}` : null,
        noun: ['heat', 'heats'] as const,
        rows: group.rows,
      }));
  })();
  const finalGroups = finalsByAgeGroup(visibleRows).map((group) => ({ ...group, noun: ['final', 'finals'] as const }));
  const groups = [...sessionGroups, ...finalGroups];
  const activeGroups = groups.filter((group) => !isGroupFinished(group.rows));
  const finishedGroups = groups.filter((group) => isGroupFinished(group.rows));
  const updated = updatedAt ? updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null;
  usePageHeader({ title, subtitle: updated ? `${competition.name} · ${updated}` : competition.name, onRefresh: reload, refreshLabel: 'Refresh timetable' });

  function renderGroup(group: typeof groups[number]) {
    const done = isGroupFinished(group.rows);
    const collapsed = done && !openDone.has(group.key);
    const heading = group.title ?? group.rows[0]?.session.name;
    if (collapsed) {
      const range = `${formatTime(group.rows[0].effective)}–${formatTime(group.rows[group.rows.length - 1].effective)}`;
      return <section key={group.key} aria-label={heading} className="tt-cell">
        <button type="button" className="tt-collapsed" aria-expanded="false" onClick={() => toggleDone(group.key)}>
          <span className="tt-dot" style={{ backgroundColor: TIMETABLE_COLOURS.finished }} aria-hidden="true" />
          <span className="tt-collapsed-copy"><strong>{heading}</strong> · {group.rows.length} finished</span>
          <span className="tt-collapsed-range">{range}</span>
          <ChevronDown className="tt-collapsed-chevron" size={14} aria-hidden="true" />
        </button>
      </section>;
    }
    const groupArenas = [...new Set(group.rows.map((row) => row.session.arenaName?.trim() ?? ''))];
    const sharedArena = groupArenas.length === 1 ? groupArenas[0] : '';
    const maxLate = groupMaxDelay(group.rows);
    const count = `${group.rows.length} ${group.rows.length === 1 ? group.noun[0] : group.noun[1]}`;
    const summary = maxLate > 0 ? [sharedArena, `${maxLate} min late`] : [sharedArena, count];
    const titleRow = group.title && <>
      <h2>{group.title}</h2>
      <span className={maxLate > 0 ? 'tt-summary-late' : undefined}>{summary.filter(Boolean).join(' · ')}</span>
    </>;
    return <section key={group.key} aria-label={heading} className="tt-group">
      {group.title && (done
        ? <button type="button" className="tt-group-title" aria-expanded="true" onClick={() => toggleDone(group.key)}>{titleRow}</button>
        : <div className="tt-group-title">{titleRow}</div>)}
      <div className="tt-card">
        {group.rows.map((row) => (
          <TimetableEvent
            key={row.key}
            row={row}
            competitionId={competition.id}
            showArena={arenas.length > 1 && !selectedArena && !sharedArena}
            hasFollowedTeam={Boolean(row.heat?.entries.some((e) => isTeamFav(e.teamId)))}
            selectedTeamId={selectedTeamId}
          />
        ))}
      </div>
    </section>;
  }

  return (
    <div className="timetable-board">
      {bandExtra}
      {(days.length > 1 || arenas.length > 1 || teamsInDay.length > 1) && (
        <div className="tt-strip">
          {days.length > 1 && (
            <div className="tt-days" role="group" aria-label="Choose day">
              {days.map((day, index) => <button key={day} type="button" className="tt-day" aria-pressed={selectedDay === day} aria-label={`Day ${index + 1}, ${new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}${day === today ? ', today' : ''}`} onClick={() => setPickedDay(day)}>
                {new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })}
              </button>)}
            </div>
          )}
          {arenas.length > 1 && <ArenaSelect arenas={arenas} selectedArena={selectedArena} dayRows={dayRows} onChoose={chooseArena} />}
          {teamsInDay.length > 1 && <TeamSelect teams={teamsInDay} selectedTeam={selectedTeam} onChoose={setTeamFilter} />}
        </div>
      )}
      <div className="tt-body">
        {lead}
        {visibleRows.some(isProvisionalRow) && (
          <p className="tt-provisional-note" role="note">Provisional timetable: times are estimates until teams and races are confirmed.</p>
        )}
        {activeGroups.map(renderGroup)}
        {finishedGroups.length > 0 && (
          <button
            type="button"
            className="mg-text-link self-center"
            aria-expanded={showFinished}
            onClick={() => setShowFinished((open) => !open)}
          >
            {showFinished ? 'Hide finished sessions' : 'Show full timetable'}
          </button>
        )}
        {finishedGroups.length > 0 && showFinished && (
          <>
            <h2 className="tt-divider">{selectedDay === today ? 'Finished today' : 'Finished'} · {finishedGroups.length}<span aria-hidden="true" /></h2>
            {finishedGroups.map(renderGroup)}
          </>
        )}
        {visibleRows.length > 0 && (
          <ul className="tt-key" aria-label="Status colours">
            {STATUS_KEY.map(([status, label]) => <li key={status}><span className="tt-dot" style={{ backgroundColor: TIMETABLE_COLOURS[status] }} aria-hidden="true" />{label}</li>)}
          </ul>
        )}
        {visibleRows.length === 0 && <p className="mg-card p-4 text-[rgb(var(--mg-muted))]">Nothing scheduled for this day.</p>}
        <SponsorStrip placement="Timetable" />
        {footer}
      </div>
    </div>
  );
}

/** A race session with no heats yet: its time is an estimate. */
const isProvisionalRow = (row: TimetableRow) => !row.heat && (row.session.kind ?? (row.session.isBreak ? 1 : 0)) === 0;

/** The arena menu: "All arenas", then each arena (with "on now" when one is running). */
function ArenaSelect({ arenas, selectedArena, dayRows, onChoose }: {
  arenas: string[];
  selectedArena: string;
  dayRows: TimetableRow[];
  onChoose: (name: string) => void;
}) {
  const isLive = (name: string) => dayRows.some((row) => row.status === 'live' && (!name || row.session.arenaName?.trim() === name));
  const options = [{ value: '', label: 'All arenas' }, ...arenas.map((name) => ({ value: name, label: name, live: isLive(name) }))];
  return (
    <Dropdown label="Arena" value={selectedArena} options={options} onChange={onChoose} className="tt-arena-wrap" buttonClassName="tt-arena">
      <MapPin aria-hidden="true" className="tt-arena-pin" size={14} />
      <span className="tt-arena-text">{selectedArena || 'All arenas'}</span>
      {isLive(selectedArena) && <span className="tt-arena-live" aria-hidden="true" />}
      <ChevronDown aria-hidden="true" className="tt-arena-chevron" size={14} />
    </Dropdown>
  );
}

/** Distinct teams entered in any heat on this day, ordered by name. */
function dayTeams(rows: TimetableRow[]): { id: number; name: string }[] {
  const byId = new Map<number, string>();
  for (const row of rows) {
    for (const entry of row.heat?.entries ?? []) {
      if (entry.teamName && !byId.has(entry.teamId)) byId.set(entry.teamId, entry.teamName);
    }
  }
  return [...byId.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Filter the day's timetable down to a single team's heats. */
function TeamSelect({ teams, selectedTeam, onChoose }: {
  teams: { id: number; name: string }[];
  selectedTeam: string;
  onChoose: (id: string) => void;
}) {
  const current = teams.find((t) => String(t.id) === selectedTeam);
  const options = [{ value: '', label: 'All teams' }, ...teams.map((t) => ({ value: String(t.id), label: t.name }))];
  return (
    <Dropdown label="Team" value={selectedTeam} options={options} onChange={onChoose} className="tt-arena-wrap" buttonClassName="tt-arena">
      <Users aria-hidden="true" className="tt-arena-pin" size={14} />
      <span className="tt-arena-text">{current?.name ?? 'All teams'}</span>
      <ChevronDown aria-hidden="true" className="tt-arena-chevron" size={14} />
    </Dropdown>
  );
}

/** Final heats, one block per age group (in running order), after all the sessions. */
function finalsByAgeGroup(rows: TimetableRow[]) {
  const groups = new Map<string, { key: string; title: string; rows: TimetableRow[] }>();
  for (const row of rows.filter((item) => item.group === 'Finals')) {
    const key = row.session.competitionSectionId != null ? `id-${row.session.competitionSectionId}` : `name-${row.session.sectionName ?? row.session.name}`;
    const group = groups.get(key) ?? { key, title: `${displaySectionName(row.session.sectionName || row.session.name)} · Finals`, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** One timetable line: time, name with a small sub-line, "+N · planned time" when late, status colour dot. */
function TimetableEvent({ row, competitionId, showArena, hasFollowedTeam = false, selectedTeamId }: {
  row: TimetableRow;
  competitionId: number;
  showArena: boolean;
  hasFollowedTeam?: boolean;
  selectedTeamId: number | null;
}) {
  const { session, heat, status, delayMinutes } = row;
  const race = (session.kind ?? (session.isBreak ? 1 : 0)) === 0;
  const heatName = heat ? heat.label || `Heat ${row.heatIndex + 1}` : 'Heats to follow';
  const name = race ? heatName : session.name;
  const label = race ? (heat ? '' : 'Provisional') : session.kind === 2 ? 'Briefing' : session.isBreak || session.kind === 1 ? 'Break' : session.location || '';
  const teamEntry = selectedTeamId != null ? heat?.entries.find((e) => e.teamId === selectedTeamId) : undefined;
  const laneLabel = teamEntry != null ? `Lane ${teamEntry.laneIndex + 1}` : '';
  const sub = [label, laneLabel, showArena ? session.arenaName?.trim() : ''].filter(Boolean).join(' · ');
  const moved = delayMinutes > 0 && !!row.scheduled;
  const orderedRaces = heat ? heat.races.slice().sort((a, b) => a.orderIndex - b.orderIndex) : [];
  const runningRaceIndex = orderedRaces.findIndex((r) => !r.isComplete);
  const currentRaceNum = runningRaceIndex >= 0 ? runningRaceIndex + 1 : orderedRaces.length;
  const onNowText = orderedRaces.length > 0 ? `ON NOW · Race ${currentRaceNum} of ${orderedRaces.length}` : 'ON NOW';
  const content = <>
    <span className="tt-time">{moved && <span className="sr-only">Planned {formatTime(row.scheduled)}, now </span>}{formatTime(row.effective)}</span>
    <span className="tt-event">
      <strong>
        {hasFollowedTeam && <Star aria-hidden="true" className="tt-fav-star" size={12} />}
        {name}
      </strong>
      {sub && <span className="tt-sub">{sub}</span>}
      {status === 'late' && moved && <span className="tt-planned" aria-hidden="true">+{delayMinutes} · <s>{formatTime(row.scheduled)}</s></span>}
      {status === 'live' && <span className="tt-onnow" aria-hidden="true">{onNowText}</span>}
    </span>
    <span className="tt-dot" style={{ backgroundColor: TIMETABLE_COLOURS[status] }} aria-hidden="true" />
    <span className="sr-only">{statusLabel(status, delayMinutes)}</span>
    {race ? <ChevronRight className="tt-chevron" size={14} aria-hidden="true" /> : <span className="tt-chevron" aria-hidden="true" />}
  </>;
  const className = `tt-row tt-${status}${hasFollowedTeam ? ' tt-followed' : ''}`;
  return race ? <Link className={className} data-followed={hasFollowedTeam ? 'true' : undefined} to={`/competitions/${competitionId}/session/${session.id}${heat ? `?heat=${heat.id}` : ''}`}>{content}</Link> : <div className={className} data-followed={hasFollowedTeam ? 'true' : undefined}>{content}</div>;
}
