import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { computeTimings, formatTime } from '../../lib/time';
import { dayKey, defaultTimetableDay } from '../../lib/timetableDay';
import { TIMETABLE_COLOURS, groupRowsBySession, sessionOrdinals, sessionTitle, timetableRows, type TimetableRow } from '../../lib/timetableRows';
import './timetable.css';

const statusLabels = { 'on-time': 'On time', late: 'Late', live: 'On now', finished: 'Finished' };

export function TimetableBoard() {
  const { competition } = useCompetition();
  const { canOrganise } = useAuth();
  const timings = useMemo(() => computeTimings(competition.sessions), [competition.sessions]);
  const showQualifiers = canOrganise();
  const rows = useMemo(() => timetableRows(competition.sessions, timings, showQualifiers), [competition.sessions, timings, showQualifiers]);
  const ordinals = useMemo(() => sessionOrdinals(competition.sessions), [competition.sessions]);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [arena, setArena] = useState('');
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

  return (
    <div className="timetable-board">
      <header>
        <div className="timetable-head">
        <h1>Timetable</h1>
        <div className="timetable-days" role="group" aria-label="Choose day">
          {days.map((day, index) => <button key={day} type="button" aria-pressed={selectedDay === day} aria-label={`Day ${index + 1}, ${new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}${day === today ? ', today' : ''}`} onClick={() => { setPickedDay(day); setArena(''); }}>
            Day {index + 1}
          </button>)}
        </div>
        </div>
        {arenas.length > 1 && <label className="timetable-arena">Arena<select value={selectedArena} onChange={(e) => setArena(e.target.value)}><option value="">All arenas</option>{arenas.map((name) => <option key={name}>{name}</option>)}</select></label>}
      </header>
      {groupRowsBySession(visibleRows).map((group) => {
        const title = group.race ? sessionTitle(group.session, ordinals) : null;
        return <section key={group.key} aria-label={title ?? group.session.name}>
          {title && <div className="timetable-section-head"><h2>{title}</h2><span>{group.rows.length} {group.rows.length === 1 ? 'heat' : 'heats'}</span></div>}
          {group.rows.map((row) => <TimetableEvent key={row.key} row={row} competitionId={competition.id} showArena={arenas.length > 1 && !selectedArena} />)}
        </section>;
      })}
      {visibleRows.length === 0 && <p className="timetable-empty">Nothing scheduled for this day.</p>}
      <ul className="timetable-legend" aria-label="Status colours">
        {Object.entries(statusLabels).map(([status, label]) => <li key={status}><span style={{ backgroundColor: TIMETABLE_COLOURS[status as keyof typeof TIMETABLE_COLOURS] }} aria-hidden="true" />{label}</li>)}
      </ul>
    </div>
  );
}

function TimetableEvent({ row, competitionId, showArena }: { row: TimetableRow; competitionId: number; showArena: boolean }) {
  const { session, heat, status, delayMinutes } = row;
  const race = (session.kind ?? (session.isBreak ? 1 : 0)) === 0;
  const heatName = heat ? heat.label || `Heat ${row.heatIndex + 1}` : 'Heats to follow';
  const name = race ? heatName : session.name;
  const label = race ? '' : session.kind === 2 ? 'Briefing' : session.isBreak || session.kind === 1 ? 'Break' : session.location || '';
  const content = <>
    <span className="timetable-time">{formatTime(row.effective)}{delayMinutes > 0 && row.scheduled && <s>{formatTime(row.scheduled)}</s>}</span>
    <span className="timetable-event"><strong>{name}</strong>{label && <span>{label}</span>}{showArena && session.arenaName && <small>{session.arenaName}</small>}</span>
    {delayMinutes > 0 && <span className="timetable-delay">+{delayMinutes} min</span>}
    <span className="timetable-dot" style={{ backgroundColor: TIMETABLE_COLOURS[status] }} aria-hidden="true" />
    <span className="sr-only">{statusLabels[status]}</span>
    {race && <ChevronRight className="timetable-chevron" size={20} aria-hidden="true" />}
  </>;
  const className = `timetable-row timetable-${status}`;
  return race ? <Link className={className} to={`/competitions/${competitionId}/session/${session.id}${heat ? `?heat=${heat.id}` : ''}`}>{content}</Link> : <div className={className}>{content}</div>;
}
