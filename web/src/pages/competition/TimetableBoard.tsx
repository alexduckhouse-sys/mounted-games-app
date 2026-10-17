import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, MapPin, RotateCw, X } from 'lucide-react';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { computeTimings, formatTime } from '../../lib/time';
import { displaySectionName } from '../../lib/section';
import { dayKey, defaultTimetableDay } from '../../lib/timetableDay';
import { groupRowsBySession, hiddenFinishedKeys, sessionOrdinals, statusLabel, TIMETABLE_COLOURS, timetableRows, type TimetableRow, type TimetableStatus } from '../../lib/timetableRows';
import './timetable.css';

const STATUS_KEY: ReadonlyArray<[TimetableStatus, string]> = [['on-time', 'On time'], ['late', 'Late'], ['live', 'On now'], ['finished', 'Finished']];

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
        <ArenaPicker arenas={arenas} selectedArena={selectedArena} dayRows={dayRows} onChoose={chooseArena} />
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
        {visibleRows.length > 0 && (
          <ul className="tt-key" aria-label="Status colours">
            {STATUS_KEY.map(([status, label]) => <li key={status}><span className="tt-dot" style={{ backgroundColor: TIMETABLE_COLOURS[status] }} aria-hidden="true" />{label}</li>)}
          </ul>
        )}
        {visibleRows.length === 0 && <p className="mg-card p-4 text-[rgb(var(--mg-muted))]">Nothing scheduled for this day.</p>}
        {footer}
      </div>
    </div>
  );
}

function ArenaPicker({ arenas, selectedArena, dayRows, onChoose }: {
  arenas: string[];
  selectedArena: string;
  dayRows: TimetableRow[];
  onChoose: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const selectedRows = selectedArena ? dayRows.filter((row) => row.session.arenaName?.trim() === selectedArena) : dayRows;
  const selectedLive = selectedRows.some((row) => row.status === 'live');

  function close() {
    setOpen(false);
    window.setTimeout(() => pickerRef.current?.focus(), 0);
  }

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const selected = sheetRef.current?.querySelector<HTMLButtonElement>('.tt-arena-option[aria-pressed="true"]');
    (selected ?? sheetRef.current?.querySelector<HTMLButtonElement>('button'))?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...(sheetRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const options = ['', ...arenas];
  return <>
    <div className="tt-arena-picker-band mg-band">
      <button ref={pickerRef} type="button" className="tt-arena-picker" aria-label={`Arena: ${selectedArena || 'All arenas'}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <MapPin aria-hidden="true" className="tt-arena-picker-icon" />
        <span className="tt-arena-picker-copy"><span>Arena</span><strong>{selectedArena || 'All arenas'}</strong></span>
        {selectedLive && <span className="mg-badge mg-badge-live">Live</span>}
        <ChevronDown aria-hidden="true" className="tt-arena-picker-chevron" />
      </button>
    </div>
    {open && createPortal(
      <div className="tt-arena-overlay" onPointerDown={(event) => { if (event.target === event.currentTarget) close(); }}>
        <div ref={sheetRef} role="dialog" aria-modal="true" aria-label="Choose arena" className="tt-arena-sheet">
          <span className="tt-arena-handle" aria-hidden="true" />
          <div className="tt-arena-sheet-head">
            <h2>Choose arena</h2>
            <button type="button" className="mg-icon-btn" aria-label="Close arena picker" onClick={close}><X aria-hidden="true" className="h-5 w-5" /></button>
          </div>
          <div className="tt-arena-options">
            {options.map((name) => {
              const optionRows = name ? dayRows.filter((row) => row.session.arenaName?.trim() === name) : dayRows;
              const live = optionRows.some((row) => row.status === 'live');
              const finished = !!name && optionRows.length > 0 && optionRows.every((row) => row.status === 'finished');
              const summary = name ? arenaSummary(optionRows) : 'Everything, in running order';
              return <button key={name || 'all'} type="button" className="tt-arena-option" aria-label={`${name || 'All arenas'}. ${summary}`} aria-pressed={selectedArena === name} onClick={() => { onChoose(name); close(); }}>
                <span className="tt-arena-radio" aria-hidden="true" />
                <span className="tt-arena-option-copy"><strong>{name || 'All arenas'}</strong><span>{summary}</span></span>
                {name && !finished && <span className={`mg-badge ${live ? 'mg-badge-live' : 'mg-badge-outline'}`}>{live ? 'Live' : 'Later'}</span>}
              </button>;
            })}
          </div>
          <p className="tt-arena-note">We’ll remember your arena on this phone.</p>
        </div>
      </div>,
      document.body,
    )}
  </>;
}

function arenaSummary(rows: TimetableRow[]) {
  const live = rows.find((row) => row.status === 'live');
  if (live) return `On now: ${timetableRowName(live)}${live.delayMinutes > 0 ? ` · running ${live.delayMinutes} min late` : ''}`;
  const upcoming = rows.find((row) => row.status !== 'finished');
  if (upcoming) return `Starts ${formatArenaTime(upcoming.effective)} · ${timetableRowName(upcoming)}`;
  return 'Finished';
}

function timetableRowName(row: TimetableRow) {
  return row.heat?.label || (row.heat ? `Heat ${row.heatIndex + 1}` : row.session.name);
}

function formatArenaTime(value: Date | null) {
  return value?.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) ?? '—';
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

/** One timetable line: time (with the planned time struck through when late), name, status colour dot. */
function TimetableEvent({ row, competitionId, showArena }: { row: TimetableRow; competitionId: number; showArena: boolean }) {
  const { session, heat, status, delayMinutes } = row;
  const race = (session.kind ?? (session.isBreak ? 1 : 0)) === 0;
  const heatName = heat ? heat.label || `Heat ${row.heatIndex + 1}` : 'Heats to follow';
  const name = race ? heatName : session.name;
  const label = race ? '' : session.kind === 2 ? 'Briefing' : session.isBreak || session.kind === 1 ? 'Break' : session.location || '';
  const sub = [label, showArena ? session.arenaName?.trim() : ''].filter(Boolean).join(' · ');
  const content = <>
    <span className="tt-time">
      {delayMinutes > 0 && row.scheduled && <s><span className="sr-only">Planned </span>{formatTime(row.scheduled)}</s>}
      <span>{delayMinutes > 0 && row.scheduled && <span className="sr-only">, now </span>}{formatTime(row.effective)}</span>
    </span>
    <span className="tt-event"><strong>{name}</strong>{sub && <span>{sub}</span>}</span>
    <span className="tt-dot" style={{ backgroundColor: TIMETABLE_COLOURS[status] }} aria-hidden="true" />
    <span className="sr-only">{statusLabel(status, delayMinutes)}</span>
    {race ? <ChevronRight className="tt-chevron" size={16} aria-hidden="true" /> : <span className="tt-chevron" aria-hidden="true" />}
  </>;
  const className = `tt-row tt-${status}`;
  return race ? <Link className={className} to={`/competitions/${competitionId}/session/${session.id}${heat ? `?heat=${heat.id}` : ''}`}>{content}</Link> : <div className={className}>{content}</div>;
}
