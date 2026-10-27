import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight, Clock, Star, X } from 'lucide-react';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import { Notice } from '../../components/Notice';
import { Sheet } from '../../components/Sheet';
import { useOptionalTicker } from '../../components/TickerContext';
import { usePageWidth } from '../../components/pageWidthState';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { SponsorStrip } from '../../components/SponsorStrip';
import { useFavourites } from '../../hooks/useFavourites';
import { computeTimings, formatDelayDuration, formatShiftDelta, formatTime, parsePausedAtMs, predictMinutesPerRace } from '../../lib/time';
import { displaySectionName } from '../../lib/section';
import { dayKey, defaultTimetableDay } from '../../lib/timetableDay';
import { arenaDelays, lastFinishedRow, sessionOrdinals, TIMETABLE_COLOURS, timetableRows, type TimetableRow, type TimetableStatus } from '../../lib/timetableRows';
import { HeatRing } from '../../components/HeatRing';
import { DelaySheet } from './DelaySheet';
import { useLanguage, useT } from '../../i18n/LanguageContext';
import type { Translate } from '../../i18n/translate';
import './timetable.css';

const STATUS_KEY: ReadonlyArray<[TimetableStatus, 'competition.timetable.statusOnTime' | 'competition.timetable.statusLate' | 'competition.timetable.statusLive' | 'common.finished']> = [
  ['on-time', 'competition.timetable.statusOnTime'], ['late', 'competition.timetable.statusLate'], ['live', 'competition.timetable.statusLive'], ['finished', 'common.finished'],
];

/** A delay as it reads in a sentence: "10 minutes", or "1h 34m" from an hour up. */
function delayText(minutes: number, t: Translate): string {
  const m = Math.max(0, Math.round(minutes));
  return m >= 60 ? formatDelayDuration(m) : t('competition.timetable.minutes', { count: m });
}

/** The words on a row's status: "On now", "+8 min", "On time" or "Finished". */
function statusText(status: TimetableStatus, delayMinutes: number, t: Translate): string {
  if (status === 'finished') return t('common.finished');
  if (status === 'live') return t('competition.timetable.statusLive');
  return status === 'late' ? `+${formatDelayDuration(delayMinutes)}` : t('competition.timetable.statusOnTime');
}

/**
 * The public timetable: one amber line when an arena is running late, then one block per session, break and age
 * group's finals. Day, arena and age group are chosen in a sheet opened from the filter button beside the ticker
 * dock; the header line says what is showing ("Tuesday · All ages") and any arena or age group set shows as a chip
 * you can clear. Only the most recent finished heat shows (greyed); the rest come back with "Show full timetable".
 * Organisers get a pencil in the header that opens the timing sheet, to move the times by a number of minutes.
 * `bandExtra`, `lead` and `footer` let a page add its own controls.
 */
export function TimetableBoard({ sectionId = null, title: titleProp, bandExtra, lead, footer }: {
  sectionId?: number | null;
  title?: string;
  bandExtra?: ReactNode;
  lead?: ReactNode;
  footer?: ReactNode;
} = {}) {
  usePageWidth('wide');
  const t = useT();
  const { locale } = useLanguage();
  const title = titleProp ?? t('competition.timetable.title');
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
  const [arena, setArena] = useState(() => { try { return localStorage.getItem(arenaKey) ?? ''; } catch { return ''; } });
  const [sectionFilter, setSectionFilter] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [delayOpen, setDelayOpen] = useState(false);
  // Which way the list slides in after the day changes, and a counter that restarts the slide.
  const [dayMove, setDayMove] = useState<{ count: number; dir: 'left' | 'right' }>({ count: 0, dir: 'right' });
  const [shifting, setShifting] = useState(false);
  const [actionError, setActionError] = useState<{ text: string; retry?: () => void } | null>(null);
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
      setActionError({ text: 'Couldn’t shift the timetable. Check your signal and try again.', retry: () => void shiftTimes(deltaMinutes) });
      return false;
    } finally {
      setShifting(false);
    }
  }
  // Pause has gone; this only sets going again a timetable that was paused before.
  async function resume() {
    setShifting(true);
    setActionError(null);
    try {
      await api.post(`/competitions/${competition.id}/sessions/resume`, { arenaName: selectedArena || undefined });
      reload();
    } catch {
      setActionError({ text: 'Couldn’t continue the timetable. Check your signal and try again.', retry: () => void resume() });
    } finally {
      setShifting(false);
    }
  }
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
  const inSection = (row: TimetableRow, id: number) => {
    if (row.session.competitionSectionId != null) return row.session.competitionSectionId === id;
    if (row.heat) return row.heat.entries.some((e) => teamSectionById.get(e.teamId) === id);
    return row.session.heats.some((h) => h.entries.some((e) => teamSectionById.get(e.teamId) === id));
  };
  const arenaRows = dayRows.filter((row) => !selectedArena || row.session.arenaName?.trim() === selectedArena || !row.session.arenaName?.trim());
  const visibleRows = arenaRows.filter((row) => selectedSectionId == null || inSection(row, selectedSectionId));

  // Only the latest finished heat stays on show; the rest wait behind "Show full timetable".
  const latestFinished = lastFinishedRow(visibleRows);
  const hiddenFinished = visibleRows.filter((row) => row.status === 'finished' && row !== latestFinished).length;
  const shownRows = showFinished ? visibleRows : visibleRows.filter((row) => row.status !== 'finished' || row === latestFinished);
  const lateArenas = arenaDelays(visibleRows);

  const sessionGroups = (() => {
    const bySession = new Map<number, { key: string; session: TimetableRow['session']; race: boolean; rows: TimetableRow[] }>();
    for (const row of shownRows.filter((item) => item.group === 'Heats')) {
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
        title: group.race
          ? t('competition.timetable.sessionTitle', { name: displaySectionName(group.session.sectionName || group.session.name), n: ordinals.get(group.session.id) ?? 1 })
          : isBreakSession(group.session) ? t('competition.timetable.break') : null,
        noun: 'heats' as const,
        // A break's line says how long it lasts instead of counting heats.
        length: !group.race && isBreakSession(group.session) && group.session.durationMinutes ? delayText(group.session.durationMinutes, t) : null,
        rows: group.rows,
      }));
  })();
  const finalGroups = finalsByAgeGroup(shownRows).map((group) => ({ ...group, title: t('competition.timetable.finalsTitle', { name: group.name }), noun: 'finals' as const, length: null }));
  const groups = [...sessionGroups, ...finalGroups].sort((a, b) => {
    const aStart = (a.rows[0]?.effective ?? a.rows[0]?.scheduled)?.getTime() ?? Infinity;
    const bStart = (b.rows[0]?.effective ?? b.rows[0]?.scheduled)?.getTime() ?? Infinity;
    return aStart - bStart || (a.rows[0]?.session.orderIndex ?? 0) - (b.rows[0]?.session.orderIndex ?? 0) || (a.rows[0]?.session.id ?? 0) - (b.rows[0]?.session.id ?? 0);
  });
  const updated = updatedAt ? updatedAt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : null;
  const filterable = days.length > 1 || showArenaSelect || showSectionSelect;
  const dayLabel = dayLabels(days);
  const sectionLabel = sections.find((s) => String(s.id) === selectedSection)?.label;
  // With filters the header line says what is showing; otherwise it keeps the competition and update time.
  const summary = [dayLabel(selectedDay), selectedArena, showSectionSelect ? sectionLabel ?? t('competition.timetable.allAges') : ''].filter(Boolean).join(' · ');
  usePageHeader({
    title,
    subtitle: filterable ? summary : updated ? `${competition.name} · ${updated}` : competition.name,
    onRefresh: reload,
    refreshLabel: t('competition.timetable.refresh'),
    onEdit: showQualifiers ? () => setDelayOpen(true) : undefined,
    editLabel: 'Change the timing',
    editing: delayOpen,
  });
  const ticker = useOptionalTicker();
  const setDockAction = ticker?.setDockAction;
  const filterCount = (selectedArena ? 1 : 0) + (selectedSection ? 1 : 0);
  useEffect(() => {
    if (!setDockAction || !filterable) return;
    setDockAction({ label: 'Day, arena and age group', count: filterCount, onClick: () => setSheetOpen(true) });
    return () => setDockAction(null);
  }, [setDockAction, filterable, filterCount]);
  function pickDay(day: string) {
    if (day === selectedDay) return;
    setDayMove((move) => ({ count: move.count + 1, dir: days.indexOf(day) > days.indexOf(selectedDay) ? 'right' : 'left' }));
    setPickedDay(day);
  }
  const swapClass = dayMove.count > 0 ? ` tt-in-${dayMove.dir}-${dayMove.count % 2}` : '';
  const heatCount = visibleRows.filter(isRaceRow).length;

  function renderGroup(group: typeof groups[number]) {
    const heading = group.title ?? group.rows[0]?.session.name;
    const groupArenas = [...new Set(group.rows.map((row) => row.session.arenaName?.trim() ?? ''))];
    const sharedArena = groupArenas.length === 1 ? groupArenas[0] : '';
    const count = group.length ?? t(group.noun === 'heats' ? 'competition.timetable.heats' : 'competition.timetable.finals', { count: group.rows.length });
    return <section key={group.key} aria-label={heading} className="tt-group">
      {group.title && <div className="tt-group-title">
        <h2>{group.title}</h2>
        <span>{[sharedArena, count].filter(Boolean).join(' · ')}</span>
      </div>}
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
      {lateArenas.map((late) => (
        <p key={late.arena} className="tt-late-line" role="status">
          <Clock aria-hidden="true" size={17} />
          {late.arena ? t('competition.timetable.lateArena', { arena: late.arena, delay: delayText(late.minutes, t) }) : t('competition.timetable.late', { delay: delayText(late.minutes, t) })}
        </p>
      ))}
      {showQualifiers && delayOpen && (
        <DelaySheet
          arena={selectedArena}
          lateMinutes={Math.max(0, ...lateArenas.filter((late) => !selectedArena || late.arena === selectedArena).map((late) => late.minutes))}
          paused={isPaused}
          busy={shifting}
          pace={pace.avgMinutesPerRace != null && (pace.sampleHeats >= 2 || pace.sampleRaces >= 5) ? pace.avgMinutesPerRace : null}
          onShift={shiftTimes}
          onContinue={() => void resume()}
          onClose={() => setDelayOpen(false)}
        />
      )}
      {(selectedArena || sectionLabel) && (
        <div className="tt-chips">
          {selectedArena && <button type="button" className="tt-chip" aria-label={`Remove ${selectedArena}`} onClick={() => chooseArena('')}>{selectedArena}<X aria-hidden="true" size={15} strokeWidth={2.2} /></button>}
          {sectionLabel && <button type="button" className="tt-chip" aria-label={`Remove ${sectionLabel}`} onClick={() => setSectionFilter('')}>{sectionLabel}<X aria-hidden="true" size={15} strokeWidth={2.2} /></button>}
        </div>
      )}
      {actionError && <Notice className="mx-4 my-2" actionLabel={actionError.retry ? 'Try again' : undefined} onAction={actionError.retry}>{actionError.text}</Notice>}
      <div className={`tt-body${swapClass}`}>
        {lead}
        {visibleRows.some(isProvisionalRow) && (
          <p className="tt-provisional-note" role="note">{t('competition.timetable.provisional')}</p>
        )}
        {groups.map(renderGroup)}
        {visibleRows.length > 0 && (
          <ul className="tt-key" aria-label={t('competition.timetable.statusColours')}>
            {STATUS_KEY.map(([status, key]) => <li key={status}><span className="tt-dot" style={{ backgroundColor: TIMETABLE_COLOURS[status] }} aria-hidden="true" />{t(key)}</li>)}
          </ul>
        )}
        {visibleRows.length === 0 && <p className="mg-card p-4 text-[rgb(var(--mg-muted))]">{t('competition.timetable.empty')}</p>}
        {(hiddenFinished > 0 || showFinished || Boolean(footer)) && (
          <button
            type="button"
            className="mg-text-link self-center"
            aria-expanded={showFinished}
            onClick={() => setShowFinished((open) => !open)}
          >
            {showFinished ? t('competition.timetable.hideFinished') : t('competition.timetable.showFull')}
          </button>
        )}
        {showFinished && footer}
        <SponsorStrip placement="Timetable" />
      </div>
      {sheetOpen && (
        <Sheet title="Day, arena and age group" className="tt-sheet" onClose={() => setSheetOpen(false)}>
          {({ close }) => (
            <>
              {days.length > 1 && (
                <div className="tt-days" role="group" aria-label="Day" style={{ '--n': days.length, '--i': days.indexOf(selectedDay) } as CSSProperties}>
                  {days.map((day) => (
                    <button key={day} type="button" aria-pressed={day === selectedDay} onClick={() => pickDay(day)}>{dayLabel(day)}</button>
                  ))}
                  <span className="tt-days-bar" aria-hidden="true" />
                </div>
              )}
              {showSectionSelect && (
                <div className={`tt-tiles${swapClass}`} role="group" aria-label="Age group">
                  {sections.map((section) => {
                    const chosen = String(section.id) === selectedSection;
                    return (
                      <button key={section.id} type="button" className="tt-tile" aria-pressed={chosen} onClick={() => setSectionFilter(chosen ? '' : String(section.id))}>
                        <strong>{section.label}</strong>
                        <span>{whatsOn(arenaRows.filter((row) => isRaceRow(row) && inSection(row, section.id)))}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {showArenaSelect && (
                <div className="tt-arena-line">
                  <span>Arena</span>
                  <div className="tt-seg" role="group" aria-label="Arena" style={{ '--n': arenas.length + 1, '--i': selectedArena ? arenas.indexOf(selectedArena) + 1 : 0 } as CSSProperties}>
                    <span className="tt-seg-thumb" aria-hidden="true" />
                    {['', ...arenas].map((name) => (
                      <button key={name || 'all'} type="button" aria-pressed={name === selectedArena} onClick={() => chooseArena(name)}>{name || 'All arenas'}</button>
                    ))}
                  </div>
                </div>
              )}
              <button type="button" className="kit-pill kit-pill-fill tt-show" onClick={() => close()}>
                Show {heatCount} {heatCount === 1 ? 'heat' : 'heats'}
              </button>
            </>
          )}
        </Sheet>
      )}
    </div>
  );
}

/** A heat line (or a session still waiting for heats), as opposed to a break or a briefing. */
const isRaceRow = (row: TimetableRow) => (row.session.kind ?? (row.session.isBreak ? 1 : 0)) === 0;
const isBreakSession = (session: TimetableRow['session']) => session.kind === 1 || (session.kind == null && session.isBreak);

/** "3 heats · on now", "2 heats · next 10:30" or "Nothing this day", for an age group's tile. */
function whatsOn(rows: TimetableRow[]) {
  if (rows.length === 0) return 'Nothing this day';
  const count = `${rows.length} ${rows.length === 1 ? 'heat' : 'heats'}`;
  if (rows.some((row) => row.status === 'live')) return `${count} · on now`;
  const next = rows.find((row) => row.status !== 'finished');
  return next ? `${count} · next ${formatTime(next.effective)}` : count;
}

/** Day names for the tabs: "Tuesday" for up to three days, "Tue" for more, with the date when two share a name. */
function dayLabels(days: string[]) {
  const at = (day: string) => new Date(`${day}T12:00:00`);
  const weekday = days.length > 3 ? 'short' : 'long';
  const names = days.map((day) => at(day).toLocaleDateString('en-GB', { weekday }));
  const repeated = names.some((name, index) => names.indexOf(name) !== index);
  return (day: string) => repeated
    ? at(day).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })
    : at(day).toLocaleDateString('en-GB', { weekday });
}

/** A race session with no heats yet: its time is an estimate. */
const isProvisionalRow = (row: TimetableRow) => !row.heat && (row.session.kind ?? (row.session.isBreak ? 1 : 0)) === 0;

/** Final heats, one block per age group (in running order), after all the sessions. */
function finalsByAgeGroup(rows: TimetableRow[]) {
  const groups = new Map<string, { key: string; name: string; rows: TimetableRow[] }>();
  for (const row of rows.filter((item) => item.group === 'Finals')) {
    const key = row.session.competitionSectionId != null ? `id-${row.session.competitionSectionId}` : `name-${row.session.sectionName ?? row.session.name}`;
    const group = groups.get(key) ?? { key, name: displaySectionName(row.session.sectionName || row.session.name), rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** One timetable line: time, name with a small sub-line, "+N" or "−N" when moved, status colour dot. */
function TimetableEvent({ row, competitionId, showArena, hasFollowedTeam = false }: {
  row: TimetableRow;
  competitionId: number;
  showArena: boolean;
  hasFollowedTeam?: boolean;
}) {
  const t = useT();
  const { session, heat, status, delayMinutes } = row;
  // A heat that goes live while you're looking lights up once; the "On now" label glides over from the heat before.
  const live = status === 'live';
  const [liveSeen, setLiveSeen] = useState({ live, lit: 0 });
  if (liveSeen.live !== live) setLiveSeen({ live, lit: live ? liveSeen.lit + 1 : liveSeen.lit });
  const lit = liveSeen.live === live ? liveSeen.lit : liveSeen.lit + (live ? 1 : 0);
  // A delay that moves this line's start time while you're looking warms the row once, so the change is easy to spot.
  const at = row.effective?.getTime() ?? null;
  const [timeSeen, setTimeSeen] = useState({ at, shifts: 0 });
  if (timeSeen.at !== at) setTimeSeen({ at, shifts: timeSeen.shifts + 1 });
  const shifts = timeSeen.at === at ? timeSeen.shifts : timeSeen.shifts + 1;
  const race = (session.kind ?? (session.isBreak ? 1 : 0)) === 0;
  const heatName = heat ? heat.label || t('competition.timetable.heat', { n: row.heatIndex + 1 }) : t('competition.timetable.heatsToFollow');
  const name = race ? heatName : session.name;
  // A break has its own heading line, so its row needs no "Break" label.
  const label = race ? (heat ? '' : t('competition.timetable.provisionalLabel')) : session.kind === 2 ? t('competition.timetable.briefing') : isBreakSession(session) ? '' : session.location || '';
  const sub = [label, showArena ? session.arenaName?.trim() : ''].filter(Boolean).join(' · ');
  const rawDrift = row.scheduled && row.effective
    ? Math.round((row.effective.getTime() - row.scheduled.getTime()) / 60_000)
    : 0;
  const shiftMinutes = Math.abs(rawDrift) >= 5 ? rawDrift : 0;
  const moved = shiftMinutes !== 0 && !!row.scheduled;
  const showShift = moved && status !== 'live' && status !== 'finished' && session.status !== 1;
  // Just "+10" or "−5" next to the heat: no struck-out planned time.
  const shiftText = Math.abs(shiftMinutes) < 60 ? `${shiftMinutes > 0 ? '+' : '−'}${Math.abs(shiftMinutes)}` : formatShiftDelta(shiftMinutes);
  const orderedRaces = heat ? heat.races.slice().sort((a, b) => a.orderIndex - b.orderIndex) : [];
  const runningRaceIndex = orderedRaces.findIndex((r) => !r.isComplete);
  const currentRaceNum = runningRaceIndex >= 0 ? runningRaceIndex + 1 : orderedRaces.length;
  const onNowText = orderedRaces.length > 0 ? t('competition.timetable.onNowRace', { n: currentRaceNum, total: orderedRaces.length }) : t('competition.timetable.onNow');
  const timeColourClass = showShift ? (shiftMinutes > 0 ? ' tt-time-late' : ' tt-time-early') : '';
  const dot = <span className="tt-dot" style={{ backgroundColor: TIMETABLE_COLOURS[status] }} aria-hidden="true" />;
  const content = <>
    <span className={`tt-time${timeColourClass}`}>{showShift && <span className="sr-only">{t('competition.timetable.plannedNow', { time: formatTime(row.scheduled) })}{' '}</span>}{formatTime(row.effective)}</span>
    <span className="tt-event">
      <strong>
        {hasFollowedTeam && <Star aria-hidden="true" className="tt-fav-star" size={12} />}
        {name}
      </strong>
      {sub && <span className="tt-sub">{sub}</span>}
      {showShift && (
        <span className={`tt-planned${shiftMinutes < 0 ? ' tt-planned-early' : ''}`} aria-hidden="true">{shiftText}</span>
      )}
      {status === 'live' && <motion.span layoutId={`tt-onnow-${session.arenaName?.trim() ?? ''}`} layout="position" className="tt-onnow" aria-hidden="true">{onNowText}</motion.span>}
    </span>
    {/* A followed team's heat within the hour counts down in a ring where the status dot would be. */}
    {hasFollowedTeam && race && heat && status !== 'finished'
      ? <HeatRing at={row.effective} live={live} fallback={dot} />
      : dot}
    <span className="sr-only">{statusText(status, delayMinutes, t)}</span>
    {race ? <ChevronRight className="tt-chevron" size={14} aria-hidden="true" /> : <span className="tt-chevron" aria-hidden="true" />}
    {live && lit > 0 && <span key={lit} className="tt-lit" aria-hidden="true" />}
    {shifts > 0 && !live && <span key={`shift-${shifts}`} className="tt-shifted" aria-hidden="true" />}
  </>;
  const className = `tt-row tt-${status}${hasFollowedTeam ? ' tt-followed' : ''}`;
  return race ? <Link className={className} data-followed={hasFollowedTeam ? 'true' : undefined} to={`/competitions/${competitionId}/session/${session.id}${heat ? `?heat=${heat.id}` : ''}`}>{content}</Link> : <div className={className} data-followed={hasFollowedTeam ? 'true' : undefined}>{content}</div>;
}
