import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, RotateCw } from 'lucide-react';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { computeTimings, formatTime } from '../../lib/time';
import { displaySectionName } from '../../lib/section';
import { dayKey, defaultTimetableDay } from '../../lib/timetableDay';
import { groupRowsBySession, hiddenFinishedKeys, sessionOrdinals, statusLabel, timetableRows, type TimetableRow, type TimetableStatus } from '../../lib/timetableRows';
import './timetable.css';

const PILL_CLASS: Record<TimetableStatus, string> = { 'on-time': 'mg-pill-ontime', late: 'mg-pill-late', live: 'mg-pill-live', finished: 'mg-pill-done' };

/**
 * The public timetable: a white band with the title, last update and day/arena choices, then one card per
 * session and per age group's finals. `bandExtra`, `lead` and `footer` let a page add its own controls.
 */
export function TimetableBoard({ sectionId = null, title = 'Timetable', bandExtra, lead, footer }: {
  sectionId?: number | null;
  title?: string;
  bandExtra?: ReactNode;
  lead?: ReactNode;
  footer?: ReactNode;
} = {}) {
  const { competition, reload, updatedAt } = useCompetition();
  const { canOrganise } = useAuth();
  const timings = useMemo(() => computeTimings(competition.sessions), [competition.sessions]);
  const showQualifiers = canOrganise();
  const rows = useMemo(
    () => timetableRows(competition.sessions, timings, showQualifiers).filter((row) => sectionId == null || row.session.competitionSectionId === sectionId),
    [competition.sessions, timings, showQualifiers, sectionId],
  );
  const ordinals = useMemo(() => sessionOrdinals(competition.sessions), [competition.sessions]);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const arenaKey = `mg.tt.arena.${competition.id}`;
  const [showAll, setShowAll] = useState(false);
  const [arena, setArena] = useState(() => { try { return localStorage.getItem(arenaKey) ?? ''; } catch { return ''; } });
  function chooseArena(name: string) {
    setArena(name);
    try { if (name) localStorage.setItem(arenaKey, name); else localStorage.removeItem(arenaKey); } catch { /* storage blocked */ }
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
  const visibleRows = dayRows.filter((row) => !selectedArena || row.session.arenaName?.trim() === selectedArena || !row.session.arenaName?.trim());

  const sessionGroups = groupRowsBySession(visibleRows.filter((row) => row.group === 'Heats')).map((group) => ({
    key: group.key,
    title: group.race ? `${displaySectionName(group.session.sectionName || group.session.name)} · Session ${ordinals.get(group.session.id) ?? 1}` : null,
    noun: ['heat', 'heats'] as const,
    rows: group.rows,
  }));
  const finalGroups = finalsByAgeGroup(visibleRows).map((group) => ({ ...group, noun: ['final', 'finals'] as const }));
  const groups = [...sessionGroups, ...finalGroups];
  const hiddenKeys = showAll ? new Set<string>() : hiddenFinishedKeys(groups);
  const hasCompleted = hiddenFinishedKeys(groups).size > 0;
  const updated = updatedAt ? updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <div className="timetable-board">
      <div className={`tt-head ${arenas.length > 1 ? 'tt-band-joined' : 'mg-band'}`}>
        <div className="flex items-center gap-3">
          <h1 className="mg-h1 mg-h1-sm min-w-0 flex-1">{title}</h1>
          {updated && <span className="mg-meta shrink-0 font-medium">Updated {updated}</span>}
          <button type="button" className="mg-icon-btn" aria-label="Refresh timetable" onClick={reload}><RotateCw className="h-[18px] w-[18px]" /></button>
        </div>
        {bandExtra}
        {days.length > 1 && (
          <div className="mg-chips" role="group" aria-label="Choose day">
            {days.map((day, index) => <button key={day} type="button" className="mg-chip" aria-pressed={selectedDay === day} aria-label={`Day ${index + 1}, ${new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}${day === today ? ', today' : ''}`} onClick={() => setPickedDay(day)}>
              {new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })} · Day {index + 1}
            </button>)}
          </div>
        )}
      </div>
      {arenas.length > 1 && (
        <div className="tt-arenas mg-band mg-chips" role="group" aria-label="Choose arena">
          {['', ...arenas].map((name) => {
            const live = !!name && dayRows.some((row) => row.status === 'live' && row.session.arenaName?.trim() === name);
            return <button key={name || 'all'} type="button" className="mg-chip" aria-pressed={selectedArena === name} onClick={(e) => { chooseArena(name); e.currentTarget.scrollIntoView({ inline: 'center', block: 'nearest' }); }}>
              {name || 'All arenas'}
              {live && <><span className="tt-live-dot" aria-hidden="true" /><span className="sr-only">, on now</span></>}
            </button>;
          })}
        </div>
      )}
      <div className="tt-body">
        {lead}
        {groups.filter((group) => !hiddenKeys.has(group.key)).map((group) => {
          const done = group.rows.every((row) => row.status === 'finished');
          const groupArenas = [...new Set(group.rows.map((row) => row.session.arenaName?.trim() ?? ''))];
          const sharedArena = groupArenas.length === 1 ? groupArenas[0] : '';
          const count = `${group.rows.length} ${group.rows.length === 1 ? group.noun[0] : group.noun[1]}`;
          return <section key={group.key} aria-label={group.title ?? group.rows[0]?.session.name} className={`tt-group ${done ? 'tt-group-done' : ''}`}>
            {group.title && <div className="mg-section-head"><h2>{group.title}</h2><span>{[sharedArena, count].filter(Boolean).join(' · ')}</span></div>}
            <div className="mg-card mg-list">
              {group.rows.map((row) => <TimetableEvent key={row.key} row={row} competitionId={competition.id} showArena={arenas.length > 1 && !selectedArena && !sharedArena} />)}
            </div>
          </section>;
        })}
        {(hasCompleted || showAll) && <button type="button" className="mg-btn mg-btn-secondary w-full" aria-pressed={showAll} onClick={() => setShowAll((v) => !v)}>{showAll ? 'Hide completed sessions' : 'View complete timetable'}</button>}
        {visibleRows.length === 0 && <p className="mg-card p-4 text-[rgb(var(--mg-muted))]">Nothing scheduled for this day.</p>}
        {footer}
      </div>
    </div>
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

/** One timetable line: time (with the planned time struck through when late), name, status pill. */
export function TimetableEvent({ row, competitionId, showArena, detail }: { row: TimetableRow; competitionId: number; showArena: boolean; detail?: string }) {
  const { session, heat, status, delayMinutes } = row;
  const race = (session.kind ?? (session.isBreak ? 1 : 0)) === 0;
  const heatName = heat ? heat.label || `Heat ${row.heatIndex + 1}` : 'Heats to follow';
  const name = race ? heatName : session.name;
  const label = race ? '' : session.kind === 2 ? 'Briefing' : session.isBreak || session.kind === 1 ? 'Break' : session.location || '';
  const sub = [detail, label, showArena ? session.arenaName?.trim() : ''].filter(Boolean).join(' · ');
  const content = <>
    <span className="tt-time">
      {delayMinutes > 0 && row.scheduled && <s><span className="sr-only">Planned </span>{formatTime(row.scheduled)}</s>}
      <span>{delayMinutes > 0 && row.scheduled && <span className="sr-only">, now </span>}{formatTime(row.effective)}</span>
    </span>
    <span className="tt-event"><strong>{name}</strong>{sub && <span>{sub}</span>}</span>
    <span className={`mg-pill ${PILL_CLASS[status]}`}>{statusLabel(status, delayMinutes)}</span>
    {race ? <ChevronRight className="tt-chevron" size={16} aria-hidden="true" /> : <span className="tt-chevron" aria-hidden="true" />}
  </>;
  const className = `tt-row tt-${status}`;
  return race ? <Link className={className} to={`/competitions/${competitionId}/session/${session.id}${heat ? `?heat=${heat.id}` : ''}`}>{content}</Link> : <div className={className}>{content}</div>;
}
