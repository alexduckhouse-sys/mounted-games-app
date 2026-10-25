import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, MapPin, Star, Users } from 'lucide-react';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import { Dropdown } from '../../components/Dropdown';
import { usePageWidth } from '../../components/pageWidthState';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { SponsorStrip } from '../../components/SponsorStrip';
import { useFavourites } from '../../hooks/useFavourites';
import { computeTimings, formatDelayDuration, formatShiftDelta, formatTime, parsePausedAtMs, predictMinutesPerRace } from '../../lib/time';
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
  const [nowMs, setNowMs] = useState(() => Date.now());
  const hasPausedSessions = competition.sessions.some((s) => s.status !== 2 && parsePausedAtMs(s.notes) != null);
  useEffect(() => {
    if (!hasPausedSessions) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [hasPausedSessions]);
  const timings = useMemo(() => computeTimings(competition.sessions, { nowMs }), [competition.sessions, nowMs]);
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
  const [sectionFilter, setSectionFilter] = useState('');
  const [shifting, setShifting] = useState(false);
  const [customDelay, setCustomDelay] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const pace = useMemo(() => predictMinutesPerRace(competition.sessions ?? []), [competition.sessions]);

  async function shiftTimes(deltaMinutes: number) {
    setShifting(true);
    setActionError(null);
    try {
      await api.post(`/competitions/${competition.id}/sessions/shift-times`, {
        deltaMinutes,
        arenaName: selectedArena || undefined,
      });
      reload();
      return true;
    } catch {
      setActionError('The timetable could not be shifted. Please try again.');
      return false;
    } finally {
      setShifting(false);
    }
  }
  async function togglePause(currentlyPaused: boolean) {
    setShifting(true);
    setActionError(null);
    try {
      await api.post(`/competitions/${competition.id}/sessions/${currentlyPaused ? 'resume' : 'pause'}`, {
        arenaName: selectedArena || undefined,
      });
      reload();
    } catch {
      setActionError(currentlyPaused
        ? 'The timetable could not be resumed. Please try again.'
        : 'The timetable could not be paused. Please try again.');
    } finally {
      setShifting(false);
    }
  }
  async function applyCustomDelay() {
    const parsed = Number(customDelay);
    if (!Number.isInteger(parsed) || parsed === 0 || parsed < -720 || parsed > 720) {
      setActionError('Enter a whole number from -720 to 720, excluding zero.');
      return;
    }
    if (await shiftTimes(parsed)) setCustomDelay('');
  }
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
  const arenas = [...new Set(rows.map((row) => row.session.arenaName?.trim()).filter((name): name is string => !!name))];
  const showArenaSelect = sectionId == null && arenas.length > 1;
  const selectedArena = showArenaSelect && arenas.includes(arena) ? arena : '';
  const isPaused = (competition.sessions ?? []).some(
    (s) => s.status !== 2
      && (!selectedArena || s.arenaName?.trim() === selectedArena)
      && parsePausedAtMs(s.notes) != null,
  );
  const sections = useMemo(
    () => (competition.sections ?? []).map((s) => ({
      id: s.id,
      label: displaySectionName(s.displayName || s.ageGroup),
    })),
    [competition.sections],
  );
  const showSectionSelect = sectionId == null && sections.length > 1;
  const selectedSection = showSectionSelect && sections.some((s) => String(s.id) === sectionFilter) ? sectionFilter : '';
  const selectedSectionId = selectedSection ? Number(selectedSection) : null;
  const teamSectionById = useMemo(() => {
    const map = new Map<number, number>();
    for (const t of competition.teams ?? []) {
      map.set(t.id, t.competitionSectionId);
    }
    return map;
  }, [competition.teams]);
  const visibleRows = dayRows
    .filter((row) => !selectedArena || row.session.arenaName?.trim() === selectedArena || !row.session.arenaName?.trim())
    .filter((row) => {
      if (selectedSectionId == null) return true;
      if (row.session.competitionSectionId != null) {
        return row.session.competitionSectionId === selectedSectionId;
      }
      if (row.heat) {
        return row.heat.entries.some((e) => teamSectionById.get(e.teamId) === selectedSectionId);
      }
      return row.session.heats.some((h) => h.entries.some((e) => teamSectionById.get(e.teamId) === selectedSectionId));
    });

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
  const groups = [...sessionGroups, ...finalGroups].sort((a, b) => {
    const aStart = (a.rows[0]?.effective ?? a.rows[0]?.scheduled)?.getTime() ?? Infinity;
    const bStart = (b.rows[0]?.effective ?? b.rows[0]?.scheduled)?.getTime() ?? Infinity;
    return aStart - bStart || (a.rows[0]?.session.orderIndex ?? 0) - (b.rows[0]?.session.orderIndex ?? 0) || (a.rows[0]?.session.id ?? 0) - (b.rows[0]?.session.id ?? 0);
  });
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
    const sessionLive = group.rows.some((row) => row.status === 'live' || row.session.status === 1);
    const maxLate = sessionLive ? 0 : groupMaxDelay(group.rows);
    const count = `${group.rows.length} ${group.rows.length === 1 ? group.noun[0] : group.noun[1]}`;
    const summary = maxLate > 0 ? [sharedArena, `${formatDelayDuration(maxLate)} late`] : [sharedArena, count];
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
            showArena={arenas.length > 1 && !selectedArena && (!sharedArena || !group.title)}
            hasFollowedTeam={Boolean(row.heat?.entries.some((e) => isTeamFav(e.teamId)))}
          />
        ))}
      </div>
    </section>;
  }

  return (
    <div className="timetable-board">
      {bandExtra}
      {(days.length > 1 || showArenaSelect || showSectionSelect) && (
        <div className={`tt-strip${days.length > 1 && (showArenaSelect || showSectionSelect) ? ' tt-strip-stacked' : ''}`}>
          {days.length > 1 && (
            <div className="tt-days" role="group" aria-label="Choose day">
              {days.map((day, index) => <button key={day} type="button" className="tt-day" aria-pressed={selectedDay === day} aria-label={`Day ${index + 1}, ${new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}${day === today ? ', today' : ''}`} onClick={() => setPickedDay(day)}>
                {new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })}
              </button>)}
            </div>
          )}
          {showArenaSelect && <ArenaSelect arenas={arenas} selectedArena={selectedArena} dayRows={dayRows} onChoose={chooseArena} />}
          {showSectionSelect && <SectionSelect sections={sections} selectedSection={selectedSection} onChoose={setSectionFilter} />}
        </div>
      )}
      {showQualifiers && (
        <div className="flex flex-wrap items-center gap-1.5 px-1 text-xs" role="group" aria-label="Delay timetable">
          <span className="font-semibold text-[rgb(var(--mg-muted))]">
            Shift {selectedArena || 'all arenas'}:
          </span>
          {([15, 30, -15] as const).map((delta) => (
            <button
              key={delta}
              type="button"
              disabled={shifting}
              onClick={() => void shiftTimes(delta)}
              className="rounded-md border border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-surface))] px-2 py-1 text-xs font-semibold hover:bg-[rgb(var(--mg-tint))]"
            >
              {delta > 0 ? `+${delta}m` : `${delta}m`}
            </button>
          ))}
          <button
            type="button"
            disabled={shifting}
            onClick={() => void togglePause(isPaused)}
            className={isPaused
              ? 'rounded-md border border-amber-500/40 bg-amber-500/15 px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-500/25 dark:text-amber-300'
              : 'rounded-md border border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-surface))] px-2 py-1 text-xs font-semibold hover:bg-[rgb(var(--mg-tint))]'}
          >
            {isPaused ? 'Continue' : 'Pause'}
          </button>
          <input
            type="number"
            min={-720}
            max={720}
            value={customDelay}
            onChange={(e) => setCustomDelay(e.target.value)}
            placeholder="±min"
            aria-label="Custom delay minutes"
            className="w-16 rounded-md border border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-surface))] px-2 py-1 text-xs"
          />
          <button
            type="button"
            disabled={shifting || !customDelay.trim()}
            onClick={() => void applyCustomDelay()}
            className="rounded-md border border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-surface))] px-2 py-1 text-xs font-semibold hover:bg-[rgb(var(--mg-tint))] disabled:opacity-50"
          >
            Apply
          </button>
          {pace.avgMinutesPerRace != null && (pace.sampleHeats >= 2 || pace.sampleRaces >= 5) && (
            <span className="ml-auto rounded-full bg-[rgb(var(--mg-tint))] px-2 py-0.5 text-[11px] font-medium text-[rgb(var(--mg-muted))]">
              Pace: ~{pace.avgMinutesPerRace.toFixed(1)}m/race
            </span>
          )}
        </div>
      )}
      {actionError && <p role="alert" className="px-4 py-2 text-sm text-red-700">{actionError}</p>}
      <div className="tt-body">
        {lead}
        {visibleRows.some(isProvisionalRow) && (
          <p className="tt-provisional-note" role="note">Provisional timetable: times are estimates until teams and races are confirmed.</p>
        )}
        {activeGroups.map(renderGroup)}
        {visibleRows.length > 0 && (
          <ul className="tt-key" aria-label="Status colours">
            {STATUS_KEY.map(([status, label]) => <li key={status}><span className="tt-dot" style={{ backgroundColor: TIMETABLE_COLOURS[status] }} aria-hidden="true" />{label}</li>)}
          </ul>
        )}
        {visibleRows.length === 0 && <p className="mg-card p-4 text-[rgb(var(--mg-muted))]">Nothing scheduled for this day.</p>}
        {(finishedGroups.length > 0 || Boolean(footer)) && (
          <button
            type="button"
            className="mg-text-link self-center"
            aria-expanded={showFinished}
            onClick={() => setShowFinished((open) => !open)}
          >
            {showFinished ? 'Hide finished sessions' : 'Show full timetable'}
          </button>
        )}
        {showFinished && (
          <>
            {finishedGroups.length > 0 && (
              <>
                <h2 className="tt-divider">{selectedDay === today ? 'Finished today' : 'Finished'} · {finishedGroups.length}<span aria-hidden="true" /></h2>
                {finishedGroups.map(renderGroup)}
              </>
            )}
            {footer}
          </>
        )}
        <SponsorStrip placement="Timetable" />
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

/** Filter the day's timetable down to a single age group (section). */
function SectionSelect({ sections, selectedSection, onChoose }: {
  sections: { id: number; label: string }[];
  selectedSection: string;
  onChoose: (id: string) => void;
}) {
  const current = sections.find((s) => String(s.id) === selectedSection);
  const options = [{ value: '', label: 'All age groups' }, ...sections.map((s) => ({ value: String(s.id), label: s.label }))];
  return (
    <Dropdown label="Age group" value={selectedSection} options={options} onChange={onChoose} className="tt-arena-wrap" buttonClassName="tt-arena">
      <Users aria-hidden="true" className="tt-arena-pin" size={14} />
      <span className="tt-arena-text">{current?.label ?? 'All age groups'}</span>
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
function TimetableEvent({ row, competitionId, showArena, hasFollowedTeam = false }: {
  row: TimetableRow;
  competitionId: number;
  showArena: boolean;
  hasFollowedTeam?: boolean;
}) {
  const { session, heat, status, delayMinutes } = row;
  const race = (session.kind ?? (session.isBreak ? 1 : 0)) === 0;
  const heatName = heat ? heat.label || `Heat ${row.heatIndex + 1}` : 'Heats to follow';
  const name = race ? heatName : session.name;
  const label = race ? (heat ? '' : 'Provisional') : session.kind === 2 ? 'Briefing' : session.isBreak || session.kind === 1 ? 'Break' : session.location || '';
  const sub = [label, showArena ? session.arenaName?.trim() : ''].filter(Boolean).join(' · ');
  const rawDrift = row.scheduled && row.effective
    ? Math.round((row.effective.getTime() - row.scheduled.getTime()) / 60_000)
    : 0;
  const shiftMinutes = Math.abs(rawDrift) >= 5 ? rawDrift : 0;
  const moved = shiftMinutes !== 0 && !!row.scheduled;
  const showShift = moved && status !== 'live' && status !== 'finished' && session.status !== 1;
  const shiftText = formatShiftDelta(shiftMinutes);
  const orderedRaces = heat ? heat.races.slice().sort((a, b) => a.orderIndex - b.orderIndex) : [];
  const runningRaceIndex = orderedRaces.findIndex((r) => !r.isComplete);
  const currentRaceNum = runningRaceIndex >= 0 ? runningRaceIndex + 1 : orderedRaces.length;
  const onNowText = orderedRaces.length > 0 ? `ON NOW · Race ${currentRaceNum} of ${orderedRaces.length}` : 'ON NOW';
  const timeColourClass = showShift ? (shiftMinutes > 0 ? ' tt-time-late' : ' tt-time-early') : '';
  const content = <>
    <span className={`tt-time${timeColourClass}`}>{showShift && <span className="sr-only">Planned {formatTime(row.scheduled)}, now </span>}{formatTime(row.effective)}</span>
    <span className="tt-event">
      <strong>
        {hasFollowedTeam && <Star aria-hidden="true" className="tt-fav-star" size={12} />}
        {name}
      </strong>
      {sub && <span className="tt-sub">{sub}</span>}
      {showShift && (
        <span className={`tt-planned${shiftMinutes < 0 ? ' tt-planned-early' : ''}`} aria-hidden="true">{shiftText} · <s>{formatTime(row.scheduled)}</s></span>
      )}
      {status === 'live' && <span className="tt-onnow" aria-hidden="true">{onNowText}</span>}
    </span>
    <span className="tt-dot" style={{ backgroundColor: TIMETABLE_COLOURS[status] }} aria-hidden="true" />
    <span className="sr-only">{statusLabel(status, delayMinutes)}</span>
    {race ? <ChevronRight className="tt-chevron" size={14} aria-hidden="true" /> : <span className="tt-chevron" aria-hidden="true" />}
  </>;
  const className = `tt-row tt-${status}${hasFollowedTeam ? ' tt-followed' : ''}`;
  return race ? <Link className={className} data-followed={hasFollowedTeam ? 'true' : undefined} to={`/competitions/${competitionId}/session/${session.id}${heat ? `?heat=${heat.id}` : ''}`}>{content}</Link> : <div className={className} data-followed={hasFollowedTeam ? 'true' : undefined}>{content}</div>;
}
