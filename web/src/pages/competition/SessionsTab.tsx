import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  CheckCircle2, Activity, Coffee, Plus, X, Users, CalendarDays,
  Megaphone, Sparkles, MapPin, Clock, Settings as SettingsIcon, Save, Wand2, AlertTriangle, Trophy, Download,
} from 'lucide-react';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import type { CompetitionSection, Heat, Session, SessionKind as SessionKindType } from '../../types';
import { SessionKind } from '../../types';
import { bibAccent } from '../../lib/bib';
import { computeTimings, roundTo5Min, formatTime, type SessionTiming, type HeatTiming } from '../../lib/time';
import { displaySectionName } from '../../lib/section';
import { WeatherNow, WeatherAt } from '../../components/WeatherChips';
import { toCsv, downloadCsv, safeFilename } from '../../lib/csv';

type AddKind = 'break' | 'briefing' | 'custom';

/** Flatten the live timetable into one CSV row per heat (or one row per break/briefing). */
function exportTimetableCsv(
  competitionName: string,
  sessions: Session[],
  timings: Map<number, SessionTiming>,
): void {
  const header = ['Date', 'Time', 'Arena', 'Section', 'Session', 'Heat', 'Status', 'Teams'];
  const rows: ReadonlyArray<string>[] = [];
  for (const s of sessions) {
    const t = timings.get(s.id);
    const kind = (s.kind ?? (s.isBreak ? SessionKind.Break : SessionKind.Race)) as SessionKindType;
    if (kind !== SessionKind.Race) {
      const when = t?.effective ?? t?.scheduled ?? null;
      rows.push([
        when ? when.toLocaleDateString() : '',
        when ? when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
        s.arenaName ?? '',
        '',
        s.name,
        kind === SessionKind.Break ? 'BREAK' : kind === SessionKind.Briefing ? 'BRIEFING' : 'CUSTOM',
        '',
        '',
      ]);
      continue;
    }
    const heats = s.heats.slice().sort((a, b) => a.orderIndex - b.orderIndex);
    heats.forEach((h, i) => {
      const ht = t?.heats[i];
      const when = ht?.effective ?? ht?.scheduled ?? null;
      const complete = h.races.length > 0 && h.races.every((r) => r.isComplete);
      const isLive = s.status === 1 && !complete;
      rows.push([
        when ? when.toLocaleDateString() : '',
        when ? when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
        s.arenaName ?? '',
        s.sectionName ?? '',
        s.name,
        h.label ?? `Heat ${i + 1}`,
        complete ? 'OVER' : isLive ? 'IN ARENA' : 'UPCOMING',
        h.entries.slice().sort((a, b) => a.laneIndex - b.laneIndex).map((e) => e.teamName).join(' | '),
      ]);
    });
  }
  downloadCsv(`${safeFilename(competitionName)}-timetable.csv`, toCsv(header, rows));
}

function heatIsComplete(heat: Heat): boolean {
  return heat.races.length > 0 && heat.races.every((r) => r.isComplete);
}

function orderedHeats(session: Session): Heat[] {
  return session.heats.slice().sort((a, b) => a.orderIndex - b.orderIndex);
}

function sessionTitle(s: Session): string {
  // Prefer the section name (e.g. "Senior Pairs"); fall back to the session's own name.
  const raw = s.sectionName?.trim() || s.name?.trim() || 'Section';
  return displaySectionName(raw);
}

/**
 * Heat headline. When the session's own name diverges from the section's name
 * (e.g. "Seniors · Session 2"), include that detail so trainers can tell which
 * session a heat belongs to.
 */
function heatHeadline(session: Session, heatLabel: string): string {
  const sectionPart = sessionTitle(session);
  const sessionPart = session.name?.trim();
  const looksLikeExtraInfo = sessionPart
    && sessionPart.toLowerCase() !== sectionPart.toLowerCase()
    && !sectionPart.toLowerCase().includes(sessionPart.toLowerCase());
  if (looksLikeExtraInfo) {
    return `${sectionPart} · ${sessionPart} — ${heatLabel}`;
  }
  return `${sectionPart} — ${heatLabel}`;
}

interface TimeChipProps {
  scheduled: Date | null;
  effective: Date | null;
  shifted: boolean;
  big?: boolean;
}

function TimeChip({ scheduled, effective, shifted, big }: TimeChipProps) {
  const eff = roundTo5Min(effective);
  const sch = roundTo5Min(scheduled);
  const size = big ? 'text-base sm:text-lg' : 'text-[11px]';
  return (
    <span className={`inline-flex items-baseline gap-1 font-mono tabular-nums shrink-0 ${size}`}>
      <Clock className={`inline ${big ? 'w-4 h-4' : 'w-3 h-3'} -mt-px text-slate-400`} />
      {shifted && sch && (
        <span className="line-through text-slate-400">{formatTime(sch)}</span>
      )}
      <span className={`font-bold ${shifted ? 'text-amber-700 dark:text-amber-300' : ''}`}>
        {formatTime(eff ?? sch)}
      </span>
    </span>
  );
}

export function SessionsTab() {
  const { competition, reload } = useCompetition();
  const { canEdit } = useAuth();
  const [addKind, setAddKind] = useState<AddKind | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const [autoRaces, setAutoRaces] = useState(5);
  const [autoSessions, setAutoSessions] = useState(1);
  const [autoLanes, setAutoLanes] = useState(6);
  const [autoMinutes, setAutoMinutes] = useState(15);
  const [finalsOpen, setFinalsOpen] = useState(false);

  const orderedSessions = useMemo(
    () => competition.sessions.slice().sort((a, b) => a.orderIndex - b.orderIndex),
    [competition.sessions]
  );

  const timings = useMemo(() => computeTimings(competition.sessions), [competition.sessions]);

  const anyShift = useMemo(
    () => Array.from(timings.values()).some((t) => t.shifted),
    [timings]
  );

  const raceSessions = useMemo(
    () => orderedSessions.filter((s) => ((s.kind ?? (s.isBreak ? SessionKind.Break : SessionKind.Race)) === SessionKind.Race)),
    [orderedSessions]
  );
  const hasAnyHeats = raceSessions.some((s) => s.heats.length > 0);

  async function autoTimetable() {
    setAutoBusy(true);
    try {
      await api.post(`/competitions/${competition.id}/auto-timetable`, {
        racesPerHeat: autoRaces,
        sessionsPerSection: autoSessions,
        lanesPerHeat: autoLanes,
        minutesPerHeat: autoMinutes,
        minutesBetweenSessions: 10,
        replaceExisting: true,
        sectionIds: null,
      });
      setAutoOpen(false);
      reload();
    } finally {
      setAutoBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5 items-start">
        <Link
          to="arena"
          className="btn-ghost !py-1.5 !px-2.5 text-xs bg-arena-live/20 text-amber-800 dark:text-amber-100 hover:bg-arena-live/30"
          title="See the current arena setup with race diagrams"
        >
          <Activity className="w-3.5 h-3.5" /> Arena setup
        </Link>
        <Link
          to="steward"
          className="btn-ghost !py-1.5 !px-2.5 text-xs text-rose-700 dark:text-rose-200 bg-rose-50 dark:bg-rose-900/30 hover:bg-rose-100"
          title="Volunteer steward — report eliminations from a lane"
        >
          <AlertTriangle className="w-3.5 h-3.5" /> Steward mode
        </Link>
        <WeatherNow lat={competition.latitude} lon={competition.longitude} />
        <button
          onClick={() => exportTimetableCsv(competition.name, orderedSessions, timings)}
          className="btn-ghost !py-1.5 !px-2.5 text-xs"
          title="Download timetable as CSV"
        >
          <Download className="w-3.5 h-3.5" /> CSV
        </button>
        <div className="ml-auto" />
        {canEdit() && (
          <>
          <button className="btn-primary !py-1.5 !px-2.5 text-xs" onClick={() => setAutoOpen((v) => !v)} disabled={autoBusy}>
            <Wand2 className="w-3.5 h-3.5" /> Auto-generate
          </button>
          <button className="btn-ghost !py-1.5 !px-2.5 text-xs" onClick={() => setAddKind('break')}>
            <Coffee className="w-3.5 h-3.5" /> Break
          </button>
          <button className="btn-ghost !py-1.5 !px-2.5 text-xs" onClick={() => setAddKind('briefing')}>
            <Megaphone className="w-3.5 h-3.5" /> Briefing
          </button>
          <button className="btn-ghost !py-1.5 !px-2.5 text-xs" onClick={() => setAddKind('custom')}>
            <Sparkles className="w-3.5 h-3.5" /> Custom
          </button>
          <button
            className="btn-ghost !py-1.5 !px-2.5 text-xs"
            onClick={async () => {
              if (!confirm('Move all unstarted sessions forward by one day?')) return;
              await api.post(`/competitions/${competition.id}/shift-day`, null, { params: { days: 1 } });
              reload();
            }}
            title="Push unstarted sessions to the next day"
          >
            <CalendarDays className="w-3.5 h-3.5" /> Next day
          </button>
          </>
        )}
      </div>

      {autoOpen && canEdit() && (
        <div className="card p-3 space-y-2">
          <p className="text-xs text-slate-600 dark:text-slate-200">
            One session per section with balanced heats. Replaces existing race sessions.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <label className="flex flex-col">
              <span className="text-slate-500 dark:text-slate-300">Races per heat</span>
              <input type="number" min={1} max={20} className="input !py-1 !px-2 text-sm"
                value={autoRaces} onChange={(e) => setAutoRaces(Math.max(1, parseInt(e.target.value, 10) || 1))} />
            </label>
            <label className="flex flex-col">
              <span className="text-slate-500 dark:text-slate-300">Sessions / section</span>
              <input type="number" min={1} max={10} className="input !py-1 !px-2 text-sm"
                value={autoSessions} onChange={(e) => setAutoSessions(Math.max(1, parseInt(e.target.value, 10) || 1))} />
            </label>
            <label className="flex flex-col">
              <span className="text-slate-500 dark:text-slate-300">Max teams / heat</span>
              <input type="number" min={1} max={20} className="input !py-1 !px-2 text-sm"
                value={autoLanes} onChange={(e) => setAutoLanes(Math.max(1, parseInt(e.target.value, 10) || 1))} />
            </label>
            <label className="flex flex-col">
              <span className="text-slate-500 dark:text-slate-300">Mins / race</span>
              <input type="number" min={1} max={60} className="input !py-1 !px-2 text-sm"
                value={autoMinutes} onChange={(e) => setAutoMinutes(Math.max(1, parseInt(e.target.value, 10) || 1))} />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setAutoOpen(false)} className="btn-ghost !py-1.5 !px-3 text-xs">Cancel</button>
            <button onClick={autoTimetable} disabled={autoBusy} className="btn-primary !py-1.5 !px-3 text-xs">
              <Wand2 className="w-3.5 h-3.5" /> {autoBusy ? 'Generating…' : 'Generate'}
            </button>
          </div>
        </div>
      )}

      {addKind && canEdit() && (
        <AddEntryForm kind={addKind} onCancel={() => setAddKind(null)} onSaved={() => { setAddKind(null); reload(); }} />
      )}

      {anyShift && (
        <div className="text-[11px] text-amber-700 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-md p-1.5 flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3" />
          Times have shifted from the scheduled plan — old times shown struck through, new times in amber.
        </div>
      )}

      {orderedSessions.length === 0 && (
        <p className="text-slate-500 dark:text-slate-300 text-sm">Nothing scheduled yet.</p>
      )}

      {competition.teams.length > 0 && orderedSessions.length > 0 && (
        <TeamQuickSearch />
      )}

      <ArenaSplitView
        sessions={orderedSessions}
        timings={timings}
        onUpdated={reload}
      />

      {canEdit() && hasAnyHeats && (
        <FinalsCta onOpen={() => setFinalsOpen(true)} />
      )}

      {finalsOpen && (
        <CreateFinalsModal
          competitionId={competition.id}
          sections={competition.sections}
          onClose={() => setFinalsOpen(false)}
          onCreated={() => { setFinalsOpen(false); reload(); }}
        />
      )}
    </div>
  );
}

function SessionHeatRows({
  session, timing, onUpdated,
}: {
  session: Session;
  timing: SessionTiming | undefined;
  onUpdated: () => void;
}) {
  const { canEdit } = useAuth();
  const isAdmin = canEdit();
  const heats = orderedHeats(session);
  const title = sessionTitle(session);
  const [editingAssignments, setEditingAssignments] = useState(false);
  const [populating, setPopulating] = useState(false);

  // A scaffolded finals session: has at least one heat labelled "X Final" and all heats are empty.
  const isEmptyFinals = useMemo(() => {
    if (heats.length === 0) return false;
    if (heats.some((h) => h.entries.length > 0)) return false;
    return heats.some((h) => /\bfinal\b/i.test(h.label ?? ''));
  }, [heats]);

  async function populateFinals() {
    if (!confirm('Populate these finals heats with the top teams from standings?')) return;
    setPopulating(true);
    try {
      await api.post(`/competitions/${session.competitionId}/sessions/${session.id}/populate-finals`);
      onUpdated();
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } } }).response?.data?.message
        ?? 'Could not populate finals.';
      alert(msg);
    } finally {
      setPopulating(false);
    }
  }

  // The "in-arena" heat is the first not-complete heat while the session is live.
  const activeHeatId = useMemo(() => {
    if (session.status !== 1) return null;
    return heats.find((h) => !heatIsComplete(h))?.id ?? null;
  }, [heats, session.status]);

  if (heats.length === 0) {
    return (
      <div className="card p-3 flex items-center gap-2 flex-wrap">
        <TimeChip scheduled={timing?.scheduled ?? null} effective={timing?.effective ?? null} shifted={timing?.shifted ?? false} big />
        <span className="font-bold text-base sm:text-lg flex-1 min-w-0 truncate">{title}</span>
        <span className="text-xs text-slate-500 dark:text-slate-300">No heats yet</span>
        {isAdmin && (
          <button
            className="btn-ghost !py-1 !px-2 text-xs"
            onClick={() => setEditingAssignments(true)}
            title="Manage heats"
          >
            <SettingsIcon className="w-3.5 h-3.5" /> Manage
          </button>
        )}
        {editingAssignments && isAdmin && (
          <div className="w-full">
            <HeatAssignmentEditor
              session={session}
              heats={heats}
              onClose={() => setEditingAssignments(false)}
              onSaved={() => { setEditingAssignments(false); onUpdated(); }}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {isEmptyFinals && isAdmin && (
        <div className="rounded-lg border-2 border-dashed border-amber-300 dark:border-amber-700 bg-amber-50/70 dark:bg-amber-900/20 p-3 flex items-center gap-2 flex-wrap">
          <Trophy className="w-5 h-5 text-amber-600 dark:text-amber-300 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm text-amber-900 dark:text-amber-100 truncate">
              {title} — finals scaffolded
            </div>
            <div className="text-xs text-amber-700 dark:text-amber-200">
              {heats.length} empty {heats.length === 1 ? 'heat' : 'heats'} ({heats.map((h) => h.label).filter(Boolean).join(', ')}). Populate when you're ready to seed from current standings.
            </div>
          </div>
          <button
            onClick={populateFinals}
            disabled={populating}
            className="btn-primary !py-1.5 !px-3 text-xs"
          >
            <Wand2 className="w-3.5 h-3.5" /> {populating ? 'Populating…' : 'Populate from standings'}
          </button>
        </div>
      )}
      {heats.map((h, idx) => {
        const ht = timing?.heats[idx];
        const isActive = h.id === activeHeatId;
        const isFirst = idx === 0;
        return (
          <HeatRow
            key={h.id}
            session={session}
            heat={h}
            heatIndex={idx}
            timing={ht}
            isActive={isActive}
            isFirst={isFirst}
            isAdmin={isAdmin}
            onManageHeats={() => setEditingAssignments(true)}
            onUpdated={onUpdated}
          />
        );
      })}
      {editingAssignments && isAdmin && (
        <HeatAssignmentEditor
          session={session}
          heats={heats}
          onClose={() => setEditingAssignments(false)}
          onSaved={() => { setEditingAssignments(false); onUpdated(); }}
        />
      )}
    </div>
  );
}

function HeatRow({
  session, heat, heatIndex, timing, isActive, isFirst, isAdmin, onManageHeats, onUpdated,
}: {
  session: Session;
  heat: Heat;
  heatIndex: number;
  timing: HeatTiming | undefined;
  isActive: boolean;
  isFirst: boolean;
  isAdmin: boolean;
  onManageHeats: () => void;
  onUpdated: () => void;
}) {
  const navigate = useNavigate();
  const [statusMenu, setStatusMenu] = useState(false);
  const complete = heatIsComplete(heat);
  const heatLabel = heat.label?.trim() || `Heat ${heatIndex + 1}`;
  const headline = heatHeadline(session, heatLabel);

  async function setStatus(status: number) {
    await api.put(`/competitions/${session.competitionId}/sessions/${session.id}/status`, { status });
    setStatusMenu(false);
    onUpdated();
  }

  const ring = isActive
    ? 'border-yellow-400 dark:border-yellow-500 ring-2 ring-yellow-300/60'
    : complete
      ? 'border-emerald-200 dark:border-emerald-800'
      : 'border-slate-200 dark:border-slate-700';

  return (
    <div className={`rounded-xl border ${ring} bg-white/80 dark:bg-slate-800/50 shadow-sm overflow-hidden`}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => navigate(`session/${session.id}`)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`session/${session.id}`); }
        }}
        className={`p-3 sm:p-3.5 cursor-pointer hover:bg-slate-50/80 dark:hover:bg-slate-800 transition ${
          complete ? 'opacity-80' : ''
        }`}
      >
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <TimeChip scheduled={timing?.scheduled ?? null} effective={timing?.effective ?? null} shifted={timing?.shifted ?? false} big />
          <HeatWeatherChip when={timing?.effective ?? timing?.scheduled ?? null} />
          <span className="font-bold text-base sm:text-lg leading-tight flex-1 min-w-0 truncate">
            {headline}
          </span>
          {isActive ? (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-arena-live text-yellow-900 text-xs font-bold animate-pulse">
              <Activity className="w-3 h-3" /> IN ARENA
            </span>
          ) : complete ? (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-arena-finished/90 text-white text-xs font-bold">
              <CheckCircle2 className="w-3 h-3" /> OVER
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 text-xs font-bold">
              <Clock className="w-3 h-3" /> UPCOMING
            </span>
          )}
        </div>
      </div>

      {isAdmin && (
        <div
          className="px-3 pb-2 flex items-center gap-1.5 flex-wrap text-[11px] border-t border-slate-100 dark:border-slate-700/70 pt-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="text-slate-400 dark:text-slate-500">Admin:</span>
          <button onClick={() => setStatusMenu((v) => !v)} className="btn-ghost !py-0.5 !px-1.5 text-[11px]">
            Status
          </button>
          {statusMenu && (
            <>
              {session.status !== 1 && (
                <button className="btn-ghost !py-0.5 !px-1.5 text-[11px]" onClick={() => setStatus(1)}>In Arena</button>
              )}
              {session.status !== 2 && (
                <button className="btn-ghost !py-0.5 !px-1.5 text-[11px]" onClick={() => setStatus(2)}>Finished</button>
              )}
              {session.status !== 0 && (
                <button className="btn-ghost !py-0.5 !px-1.5 text-[11px]" onClick={() => setStatus(0)}>Reset</button>
              )}
            </>
          )}
          <HeatTimePinner session={session} heat={heat} timing={timing} onSaved={onUpdated} />
          {heat.raceRoundStage === 2 && heat.entries.length === 0 && (
            <PopulateRaceFinalButton session={session} heat={heat} onSaved={onUpdated} />
          )}
          {isFirst && (
            <button onClick={onManageHeats} className="btn-ghost !py-0.5 !px-1.5 text-[11px]" title="Manage heat assignments">
              <SettingsIcon className="w-3 h-3" /> Manage heats
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function HeatTimePinner({
  session, heat, timing, onSaved,
}: {
  session: Session;
  heat: Heat;
  timing: HeatTiming | undefined;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const isPinned = !!heat.scheduledStart;

  // Pre-fill with whatever time the row currently shows so the admin only
  // tweaks the minutes, not re-types the whole stamp.
  const initial = heat.scheduledStart
    ?? (timing?.scheduled ? timing.scheduled.toISOString() : null);
  const initialLocal = initial ? toLocalInputValue(new Date(initial)) : '';
  const [value, setValue] = useState(initialLocal);

  async function save() {
    setBusy(true);
    try {
      await api.put(
        `/competitions/${session.competitionId}/sessions/${session.id}/heats/${heat.id}/scheduled-start`,
        { scheduledStart: value ? new Date(value).toISOString() : null },
      );
      setOpen(false);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      await api.put(
        `/competitions/${session.competitionId}/sessions/${session.id}/heats/${heat.id}/scheduled-start`,
        { scheduledStart: null },
      );
      setOpen(false);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`btn-ghost !py-0.5 !px-1.5 text-[11px] ${isPinned ? 'text-brand-700 dark:text-brand-200' : ''}`}
        title={isPinned ? 'This heat has a pinned start time' : 'Pin this heat to a specific start time'}
      >
        <Clock className="w-3 h-3" /> {isPinned ? 'Pinned' : 'Pin time'}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="datetime-local"
        className="input !py-0.5 !px-1 text-[11px]"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button onClick={save} disabled={busy} className="btn-primary !py-0.5 !px-1.5 text-[11px]">
        {busy ? '…' : 'Save'}
      </button>
      {isPinned && (
        <button onClick={clear} disabled={busy} className="btn-ghost !py-0.5 !px-1.5 text-[11px] text-rose-500">
          Clear
        </button>
      )}
      <button onClick={() => setOpen(false)} className="btn-ghost !py-0.5 !px-1.5 text-[11px]">
        Cancel
      </button>
    </span>
  );
}

// datetime-local needs YYYY-MM-DDTHH:MM in local time, not an ISO string.
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function PopulateRaceFinalButton({
  session, heat, onSaved,
}: {
  session: Session;
  heat: Heat;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [topN, setTopN] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function populate() {
    setBusy(true);
    setError(null);
    try {
      await api.post(
        `/competitions/${session.competitionId}/sessions/${session.id}/heats/${heat.id}/populate-race-final`,
        { topN },
      );
      setOpen(false);
      onSaved();
    } catch (e) {
      const msg = (e as { response?: { data?: string | { message?: string } } }).response?.data;
      setError(typeof msg === 'string' ? msg : msg?.message ?? 'Could not populate.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="btn-ghost !py-0.5 !px-1.5 text-[11px] text-amber-600 dark:text-amber-200"
        title="Fill the final with top X from each qualifier"
      >
        <Trophy className="w-3 h-3" /> Populate final
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <label className="inline-flex items-center gap-1 text-[11px] text-slate-500">
        Top
        <input
          type="number" min={1} max={20}
          className="input !py-0.5 !px-1 text-[11px] w-12"
          value={topN}
          onChange={(e) => setTopN(Math.max(1, parseInt(e.target.value, 10) || 1))}
        />
        per heat
      </label>
      <button onClick={populate} disabled={busy} className="btn-primary !py-0.5 !px-1.5 text-[11px]">
        {busy ? '…' : 'Fill'}
      </button>
      <button onClick={() => setOpen(false)} className="btn-ghost !py-0.5 !px-1.5 text-[11px]">Cancel</button>
      {error && <span className="text-[11px] text-rose-600 dark:text-rose-300">{error}</span>}
    </span>
  );
}

/**
 * Groups the timetable by Session.ArenaName. When more than one arena is in
 * use, render a tab-strip with each arena's sessions in its own list. With a
 * single arena (or none), fall back to the original single-column layout.
 */
function ArenaSplitView({
  sessions, timings, onUpdated,
}: {
  sessions: Session[];
  timings: Map<number, SessionTiming>;
  onUpdated: () => void;
}) {
  const arenas = useMemo(() => {
    const map = new Map<string, Session[]>();
    for (const s of sessions) {
      const key = (s.arenaName ?? '').trim() || '—';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [sessions]);
  const [active, setActive] = useState<string | 'all'>('all');
  // If there's only one arena (or none labelled), single-list view.
  const single = arenas.length <= 1;

  function renderSession(s: Session) {
    const t = timings.get(s.id);
    const kind = (s.kind ?? (s.isBreak ? SessionKind.Break : SessionKind.Race)) as SessionKindType;
    if (kind === SessionKind.Break) return <BreakRow key={s.id} s={s} timing={t} />;
    if (kind === SessionKind.Briefing) return <BriefingRow key={s.id} s={s} timing={t} />;
    if (kind === SessionKind.Custom) return <CustomRow key={s.id} s={s} timing={t} />;
    return <SessionHeatRows key={s.id} session={s} timing={t} onUpdated={onUpdated} />;
  }

  if (single) {
    return <div className="space-y-2">{sessions.map(renderSession)}</div>;
  }

  return (
    <div className="space-y-2">
      <div className="card p-1.5 flex overflow-x-auto gap-1 items-center text-xs">
        <span className="text-[10px] uppercase tracking-wide text-slate-500 px-1 shrink-0">Arena</span>
        <button
          onClick={() => setActive('all')}
          className={`whitespace-nowrap px-3 py-1 rounded-md text-xs font-medium ${
            active === 'all'
              ? 'bg-brand-600 text-white shadow-soft'
              : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          All ({sessions.length})
        </button>
        {arenas.map(([name, list]) => (
          <button
            key={name}
            onClick={() => setActive(name)}
            className={`whitespace-nowrap px-3 py-1 rounded-md text-xs font-medium ${
              active === name
                ? 'bg-brand-600 text-white shadow-soft'
                : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {name === '—' ? 'No arena' : name} <span className="opacity-60">({list.length})</span>
          </button>
        ))}
      </div>
      {active === 'all' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-3 gap-y-2">
          {arenas.map(([name, list]) => (
            <div key={name} className="space-y-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-bold px-1 flex items-center gap-1">
                <MapPin className="w-3 h-3" /> {name === '—' ? 'No arena' : name}
              </div>
              {list.map(renderSession)}
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {(arenas.find(([n]) => n === active)?.[1] ?? []).map(renderSession)}
        </div>
      )}
    </div>
  );
}

/** WeatherAt that reads lat/lon from the comp context so callers don't repeat themselves. */
function HeatWeatherChip({ when }: { when: Date | null }) {
  const { competition } = useCompetition();
  if (!when) return null;
  return <WeatherAt lat={competition.latitude} lon={competition.longitude} when={when} />;
}

function BreakRow({ s, timing }: { s: Session; timing: SessionTiming | undefined }) {
  return (
    <motion.div
      initial={{ y: 4, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
      className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-900/30 border-2 border-dashed border-amber-300 dark:border-amber-700"
    >
      <Coffee className="w-5 h-5 text-amber-600 dark:text-amber-300 shrink-0" />
      <TimeChip scheduled={timing?.scheduled ?? null} effective={timing?.effective ?? null} shifted={timing?.shifted ?? false} big />
      <span className="font-bold text-base text-amber-900 dark:text-amber-100 flex-1 truncate">{s.name}</span>
      {s.durationMinutes && (
        <span className="text-xs font-semibold text-amber-700 dark:text-amber-200 shrink-0">{s.durationMinutes} min</span>
      )}
    </motion.div>
  );
}

function BriefingRow({ s, timing }: { s: Session; timing: SessionTiming | undefined }) {
  return (
    <motion.div
      initial={{ y: 4, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
      className="px-3 py-2 rounded-xl bg-sky-50 dark:bg-sky-900/30 border-2 border-dashed border-sky-300 dark:border-sky-700"
    >
      <div className="flex items-center gap-2.5">
        <Megaphone className="w-5 h-5 text-sky-600 dark:text-sky-300 shrink-0" />
        <TimeChip scheduled={timing?.scheduled ?? null} effective={timing?.effective ?? null} shifted={timing?.shifted ?? false} big />
        <span className="font-bold text-base text-sky-900 dark:text-sky-100 flex-1 truncate">{s.name}</span>
        {s.durationMinutes && <span className="text-xs font-semibold text-sky-700 dark:text-sky-200 shrink-0">{s.durationMinutes} min</span>}
      </div>
      {s.location && (
        <div className="mt-0.5 flex items-center gap-1 text-xs text-sky-700 dark:text-sky-200 pl-7">
          <MapPin className="w-3 h-3" /> {s.location}
        </div>
      )}
    </motion.div>
  );
}

function CustomRow({ s, timing }: { s: Session; timing: SessionTiming | undefined }) {
  return (
    <motion.div
      initial={{ y: 4, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
      className="px-3 py-2 rounded-xl bg-violet-50 dark:bg-violet-900/30 border-2 border-dashed border-violet-300 dark:border-violet-700"
    >
      <div className="flex items-center gap-2.5">
        <Sparkles className="w-5 h-5 text-violet-600 dark:text-violet-300 shrink-0" />
        <TimeChip scheduled={timing?.scheduled ?? null} effective={timing?.effective ?? null} shifted={timing?.shifted ?? false} big />
        <span className="font-bold text-base text-violet-900 dark:text-violet-100 flex-1 truncate">{s.name}</span>
        {s.durationMinutes && <span className="text-xs font-semibold text-violet-700 dark:text-violet-200 shrink-0">{s.durationMinutes} min</span>}
      </div>
      {s.notes && (
        <p className="mt-0.5 text-xs text-violet-700 dark:text-violet-200 pl-7 whitespace-pre-wrap">{s.notes}</p>
      )}
    </motion.div>
  );
}

function FinalsCta({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="w-full rounded-xl border-2 border-dashed border-amber-400 dark:border-amber-600 bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-900/30 dark:to-yellow-900/30 hover:from-amber-100 hover:to-yellow-100 dark:hover:from-amber-900/50 dark:hover:to-yellow-900/50 p-4 flex items-center gap-3 transition shadow-sm"
    >
      <Trophy className="w-7 h-7 text-amber-600 dark:text-amber-300 shrink-0" />
      <div className="text-left flex-1">
        <div className="font-bold text-base sm:text-lg text-amber-900 dark:text-amber-100">Create Finals</div>
        <div className="text-xs sm:text-sm text-amber-700 dark:text-amber-200">
          Seed a finals session from current standings — top teams advance.
        </div>
      </div>
      <Plus className="w-5 h-5 text-amber-700 dark:text-amber-200 shrink-0" />
    </button>
  );
}

interface AddEntryFormProps {
  kind: AddKind;
  onCancel: () => void;
  onSaved: () => void;
}

function AddEntryForm({ kind, onCancel, onSaved }: AddEntryFormProps) {
  const { competition } = useCompetition();
  const [name, setName] = useState(
    kind === 'break' ? 'Lunch break' :
    kind === 'briefing' ? 'Riders briefing' :
    ''
  );
  const [duration, setDuration] = useState<number | ''>(kind === 'break' ? 45 : kind === 'briefing' ? 15 : 0);
  const [scheduledStart, setScheduledStart] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const maxOrder = competition.sessions.reduce((m, s) => Math.max(m, s.orderIndex), 0);
      const sessionKind =
        kind === 'break' ? SessionKind.Break :
        kind === 'briefing' ? SessionKind.Briefing :
        SessionKind.Custom;
      await api.post(`/competitions/${competition.id}/sessions`, {
        competitionSectionId: null,
        name: name.trim() || (kind === 'briefing' ? 'Briefing' : kind === 'break' ? 'Break' : 'Item'),
        arenaName: null,
        scheduledStart: scheduledStart ? new Date(scheduledStart).toISOString() : null,
        orderIndex: maxOrder + 1,
        notes: notes.trim() || null,
        isBreak: kind === 'break',
        durationMinutes: duration === '' || duration === 0 ? null : duration,
        kind: sessionKind,
        location: location.trim() || null,
      });
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  const accentClass =
    kind === 'break' ? 'border-l-4 border-amber-400' :
    kind === 'briefing' ? 'border-l-4 border-sky-400' :
    'border-l-4 border-violet-400';

  return (
    <form onSubmit={submit} className={`card p-3 space-y-2 ${accentClass}`}>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold capitalize flex-1">{kind}</h3>
        <button type="button" onClick={onCancel} className="btn-ghost !py-1 !px-1.5">
          <X className="w-4 h-4" />
        </button>
      </div>

      <label className="block">
        <span className="text-[11px] text-slate-500 dark:text-slate-300">Title</span>
        <input className="input mt-1 text-sm" value={name} onChange={(e) => setName(e.target.value)} required />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[11px] text-slate-500 dark:text-slate-300">Start time</span>
          <input type="datetime-local" className="input mt-1 text-sm"
            value={scheduledStart} onChange={(e) => setScheduledStart(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-[11px] text-slate-500 dark:text-slate-300">
            Duration (min) {kind === 'custom' ? '(optional)' : ''}
          </span>
          <input
            type="number" min={0} max={600}
            className="input mt-1 text-sm"
            value={duration}
            onChange={(e) => setDuration(e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0))}
          />
        </label>
      </div>

      {kind === 'briefing' && (
        <label className="block">
          <span className="text-[11px] text-slate-500 dark:text-slate-300">Place</span>
          <input className="input mt-1 text-sm" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Main arena" />
        </label>
      )}

      {kind === 'custom' && (
        <label className="block">
          <span className="text-[11px] text-slate-500 dark:text-slate-300">Notes (optional)</span>
          <textarea
            rows={2}
            className="input mt-1 text-sm"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Trophy presentation, kit inspection, etc."
          />
        </label>
      )}

      <div className="flex justify-end">
        <button type="submit" disabled={busy} className="btn-primary !py-1.5 !px-3 text-xs">
          <Plus className="w-3.5 h-3.5" /> {busy ? '…' : 'Add to timetable'}
        </button>
      </div>
    </form>
  );
}

function HeatAssignmentEditor({
  session,
  heats,
  onClose,
  onSaved,
}: {
  session: Session;
  heats: Heat[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { competition } = useCompetition();

  const teamsInSession = useMemo(() => {
    const map = new Map<number, { id: number; name: string; bib?: string | null; label: string }>();
    for (const h of heats) {
      const label = h.label ?? `Heat ${h.orderIndex}`;
      for (const e of h.entries) {
        if (!map.has(e.teamId)) {
          const t = competition.teams.find((x) => x.id === e.teamId);
          map.set(e.teamId, {
            id: e.teamId,
            name: t?.displayName ?? e.teamName,
            bib: t?.bibColour ?? e.bibColour,
            label,
          });
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [heats, competition.teams]);

  const labels = useMemo(() => heats.map((h, i) => h.label ?? `Heat ${i + 1}`), [heats]);
  const [picks, setPicks] = useState<Record<number, string>>(() =>
    Object.fromEntries(teamsInSession.map((t) => [t.id, t.label]))
  );
  const [busy, setBusy] = useState(false);

  function shuffle() {
    const pool = teamsInSession.map((t) => t.id).sort(() => Math.random() - 0.5);
    const buckets: Record<string, number[]> = Object.fromEntries(labels.map((l) => [l, []]));
    pool.forEach((tid, i) => buckets[labels[i % labels.length]].push(tid));
    const next: Record<number, string> = {};
    for (const label of labels) for (const tid of buckets[label]) next[tid] = label;
    setPicks(next);
  }

  async function save() {
    setBusy(true);
    try {
      const assignments = labels.map((label) => ({
        label,
        teamIds: teamsInSession.filter((t) => picks[t.id] === label).map((t) => t.id),
      }));
      await api.put(`/competitions/${competition.id}/sessions/${session.id}/heat-assignments`, { assignments });
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-3 space-y-2 border-2 border-brand-300 dark:border-brand-600">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold flex items-center gap-1.5">
          <SettingsIcon className="w-4 h-4 text-brand-600" /> Heat assignments
        </h4>
        <div className="flex gap-1.5">
          <button onClick={shuffle} className="btn-ghost !py-1 !px-2 text-[11px]">Reshuffle</button>
          <button onClick={onClose} className="btn-ghost !py-1 !px-1.5"><X className="w-3.5 h-3.5" /></button>
        </div>
      </div>
      <p className="text-[11px] text-slate-600 dark:text-slate-200">
        Pick which heat each team runs in. Saving clears any existing results in this session.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-72 overflow-auto">
        {teamsInSession.map((t) => (
          <div key={t.id} className="flex items-center gap-2 px-2 py-1 rounded-md bg-slate-50 dark:bg-slate-800/70">
            <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: bibAccent(t.bib) }} />
            <span className="text-xs flex-1 truncate">{t.name}</span>
            <select
              value={picks[t.id] ?? t.label}
              onChange={(e) => setPicks((cur) => ({ ...cur, [t.id]: e.target.value }))}
              className="input !py-0.5 !px-1 text-xs w-24"
            >
              {labels.map((l) => (<option key={l} value={l}>{l}</option>))}
            </select>
          </div>
        ))}
        {teamsInSession.length === 0 && (
          <p className="text-xs text-slate-500 dark:text-slate-300">No teams assigned to this session yet.</p>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="btn-ghost !py-1.5 !px-2.5 text-xs">Cancel</button>
        <button onClick={save} disabled={busy} className="btn-primary !py-1.5 !px-3 text-xs">
          <Save className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Save assignments'}
        </button>
      </div>
    </div>
  );
}

function CreateFinalsModal({
  competitionId,
  sections,
  onClose,
  onCreated,
}: {
  competitionId: number;
  sections: CompetitionSection[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [sectionId, setSectionId] = useState<number | ''>('');
  const [topN, setTopN] = useState(6);
  const [lanes, setLanes] = useState(6);
  const [name, setName] = useState('');
  const [raceNames, setRaceNames] = useState('Litter Lifter\nFlag\nBottle\nMug\nBall and Cone');
  const [scaffoldOnly, setScaffoldOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [boundary, setBoundary] = useState<{ tied: boolean; teams?: { id: number; name: string; total: number; wins: number }[]; cutoff?: number } | null>(null);

  // Re-check the qualification boundary whenever topN or section changes.
  useEffect(() => {
    let cancelled = false;
    const params: Record<string, number> = { topN };
    if (sectionId !== '') params.sectionId = sectionId;
    api.get<{ tied: boolean; teams?: { id: number; name: string; total: number; wins: number }[]; cutoff?: number }>(
      `/competitions/${competitionId}/finals/boundary`,
      { params }
    )
      .then((r) => { if (!cancelled) setBoundary(r.data); })
      .catch(() => { if (!cancelled) setBoundary(null); });
    return () => { cancelled = true; };
  }, [competitionId, topN, sectionId]);

  async function submit() {
    const races = raceNames.split('\n').map((r) => r.trim()).filter(Boolean);
    if (races.length === 0) { setError('Add at least one race name.'); return; }
    if (topN < 1) { setError('Top N must be at least 1.'); return; }
    setError(null);
    setBusy(true);
    try {
      if (scaffoldOnly) {
        const numHeats = Math.max(1, Math.ceil(topN / Math.max(1, lanes)));
        await api.post(`/competitions/${competitionId}/finals/scaffold`, {
          competitionSectionId: sectionId === '' ? null : sectionId,
          raceNames: races,
          lanesPerHeat: lanes,
          numHeats,
          name: name.trim() || null,
        });
      } else {
        await api.post(`/competitions/${competitionId}/finals`, {
          competitionSectionId: sectionId === '' ? null : sectionId,
          topN,
          raceNames: races,
          lanesPerHeat: lanes,
          name: name.trim() || null,
        });
      }
      onCreated();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: string | { message?: string } } })?.response?.data;
      const text = typeof msg === 'string' ? msg : msg?.message ?? 'Could not create finals.';
      setError(text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm grid place-items-center p-3"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }}
        className="card w-full max-w-md max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 p-3 border-b border-slate-200 dark:border-slate-800">
          <Trophy className="w-5 h-5 text-amber-600" />
          <h3 className="font-semibold text-base flex-1">Create finals</h3>
          <button onClick={onClose} className="btn-ghost !py-1 !px-1.5"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-3 space-y-3">
          <label className="block">
            <span className="text-xs font-semibold">Section</span>
            <select
              className="input mt-1 text-sm"
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
            >
              <option value="">All sections (overall)</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>{s.displayName}</option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-semibold">Top N teams</span>
              <input
                type="number" min={1} max={64}
                className="input mt-1 text-sm"
                value={topN}
                onChange={(e) => setTopN(Math.max(1, parseInt(e.target.value, 10) || 1))}
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold">Max teams / heat</span>
              <input
                type="number" min={1} max={20}
                className="input mt-1 text-sm"
                value={lanes}
                onChange={(e) => setLanes(Math.max(1, parseInt(e.target.value, 10) || 1))}
              />
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-semibold">Name (optional)</span>
            <input
              className="input mt-1 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Finals · Senior Pairs"
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold">Race names (one per line)</span>
            <textarea
              rows={5}
              className="input mt-1 text-sm font-mono"
              value={raceNames}
              onChange={(e) => setRaceNames(e.target.value)}
            />
          </label>

          <label className="flex items-start gap-2 text-xs cursor-pointer p-2 rounded-md bg-slate-50 dark:bg-slate-800/60">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={scaffoldOnly}
              onChange={(e) => setScaffoldOnly(e.target.checked)}
            />
            <span>
              <span className="font-semibold">Scaffold only — populate later.</span>{' '}
              <span className="text-slate-500 dark:text-slate-300">
                Creates the finals session with empty A/B/C Final heats and the race list.
                You can fill them with the top teams from standings later via the
                "Populate from standings" button on the timetable.
              </span>
            </span>
          </label>

          {boundary?.tied && boundary.teams && (
            <div className="text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-md p-2 space-y-1">
              <div className="font-semibold flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Tie at the qualification boundary
              </div>
              <p>
                {boundary.teams.length} teams are tied on points at the cut-off (top {boundary.cutoff}).
                Order of qualification will be effectively random unless you break the tie first.
              </p>
              <ul className="list-disc list-inside">
                {boundary.teams.map((t) => (
                  <li key={t.id}>{t.name} — {t.total} pts, {t.wins} wins</li>
                ))}
              </ul>
            </div>
          )}
          {error && (
            <div className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 rounded-md p-2">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 p-3 border-t border-slate-200 dark:border-slate-800">
          <button onClick={onClose} className="btn-ghost !py-1.5 !px-3 text-xs">Cancel</button>
          <button
            onClick={submit}
            disabled={busy}
            className="btn-primary !py-1.5 !px-3 text-xs ml-auto"
          >
            <Trophy className="w-3.5 h-3.5" /> {busy ? 'Creating…' : 'Create finals'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function TeamQuickSearch() {
  const { competition } = useCompetition();
  const navigate = useNavigate();
  const [pickedId, setPickedId] = useState<number | null>(null);
  const [query, setQuery] = useState('');

  const teamsSorted = useMemo(
    () => competition.teams.slice().sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [competition.teams]
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [] as typeof teamsSorted;
    return teamsSorted.filter((t) => t.displayName.toLowerCase().includes(q)).slice(0, 8);
  }, [query, teamsSorted]);

  const timings = useMemo(() => computeTimings(competition.sessions), [competition.sessions]);

  const summary = useMemo(() => {
    if (pickedId == null) return null;
    const team = competition.teams.find((t) => t.id === pickedId);
    if (!team) return null;
    type Row = { sessionId: number; sessionName: string; heatId: number; heatLabel: string; effective: Date | null; scheduled: Date | null; complete: boolean };
    const rows: Row[] = [];
    const sessions = competition.sessions
      .filter((s) => (s.kind ?? (s.isBreak ? 1 : 0)) === 0)
      .slice().sort((a, b) => a.orderIndex - b.orderIndex);
    for (const s of sessions) {
      const heats = s.heats.slice().sort((a, b) => a.orderIndex - b.orderIndex);
      const sessTiming = timings.get(s.id);
      heats.forEach((h, idx) => {
        if (!h.entries.some((e) => e.teamId === pickedId)) return;
        const ht = sessTiming?.heats[idx];
        const complete = h.races.length > 0 && h.races.every((r) => r.isComplete);
        rows.push({
          sessionId: s.id,
          sessionName: s.sectionName ?? s.name,
          heatId: h.id,
          heatLabel: h.label ?? `Heat ${idx + 1}`,
          effective: ht?.effective ?? null,
          scheduled: ht?.scheduled ?? null,
          complete,
        });
      });
    }
    return { team, rows, next: rows.find((r) => !r.complete) ?? null };
  }, [pickedId, competition.teams, competition.sessions, timings]);

  return (
    <div className="card p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-sm font-semibold flex items-center gap-1">
          <Users className="w-4 h-4 text-brand-600" /> When is my team in?
        </label>
        <input
          className="input !py-1.5 text-sm flex-1 min-w-[160px]"
          placeholder="Type a team name…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPickedId(null); }}
          list="team-quick-search"
        />
        <datalist id="team-quick-search">
          {teamsSorted.map((t) => <option key={t.id} value={t.displayName} />)}
        </datalist>
        {pickedId != null && (
          <button onClick={() => { setPickedId(null); setQuery(''); }} className="btn-ghost !py-1 !px-2 text-xs">
            <X className="w-3.5 h-3.5" /> Clear
          </button>
        )}
      </div>

      {matches.length > 0 && pickedId == null && (
        <div className="flex flex-wrap gap-1.5">
          {matches.map((t) => (
            <button
              key={t.id}
              onClick={() => { setPickedId(t.id); setQuery(t.displayName); }}
              className="px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-700 hover:bg-brand-100 dark:hover:bg-brand-900/40 text-xs font-medium"
            >
              {t.displayName}
            </button>
          ))}
        </div>
      )}

      {summary && (
        <div className="rounded-md bg-brand-50 dark:bg-brand-900/30 border border-brand-200 dark:border-brand-800 p-2.5 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm">{summary.team.displayName}</span>
            {summary.next ? (
              <>
                <span className="text-xs text-slate-500">next up:</span>
                <span className="font-mono font-bold text-base text-brand-700 dark:text-brand-200 tabular-nums">
                  {formatTime(roundTo5Min(summary.next.effective ?? summary.next.scheduled))}
                </span>
                <span className="text-xs text-slate-600 dark:text-slate-300 truncate">
                  · {summary.next.heatLabel}
                </span>
                <button
                  onClick={() => navigate(`session/${summary.next!.sessionId}`)}
                  className="btn-ghost !py-0.5 !px-2 text-[11px] ml-auto"
                >
                  View heat
                </button>
              </>
            ) : summary.rows.length > 0 ? (
              <span className="text-xs text-emerald-700 dark:text-emerald-300">All heats over.</span>
            ) : (
              <span className="text-xs text-slate-500">Not in any heats yet.</span>
            )}
          </div>
          {summary.rows.length > 1 && (
            <ul className="text-[11px] space-y-0.5">
              {summary.rows.map((r) => (
                <li key={r.heatId} className="flex items-center gap-2">
                  <span className={`font-mono tabular-nums w-10 ${r.complete ? 'line-through text-slate-400' : 'text-slate-700 dark:text-slate-100 font-semibold'}`}>
                    {formatTime(roundTo5Min(r.effective ?? r.scheduled))}
                  </span>
                  <span className={`truncate flex-1 ${r.complete ? 'line-through text-slate-400' : ''}`}>
                    {r.heatLabel}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
