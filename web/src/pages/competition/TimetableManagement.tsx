import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  CheckCircle2, Activity, Coffee, Plus, X, CalendarDays,
  Megaphone, Sparkles, MapPin, Clock, Settings as SettingsIcon, Save, Wand2, AlertTriangle, Trophy, Download,
} from 'lucide-react';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import type { CompetitionSection, Heat, Session, SessionKind as SessionKindType } from '../../types';
import { SessionKind, TieBreakRule } from '../../types';
import type { FinalsBoundary } from '../../lib/tieBreak';
import { FinalsTiePanel } from './FinalsTiePanel';
import { bibAccent } from '../../lib/bib';
import { computeTimings, roundTo5Min, formatTime, type SessionTiming, type HeatTiming } from '../../lib/time';
import { dayKey, defaultTimetableDay } from '../../lib/timetableDay';
import { displaySectionName } from '../../lib/section';
import { WeatherNow, WeatherAt } from '../../components/WeatherChips';
import { exportTimetableCsv } from '../../lib/timetableCsv';
import { SelectField } from '../../components/SelectField';
import { NumberField } from '../../components/NumberField';
import { confirmDialog } from '../../components/ConfirmDialog';

type AddKind = 'break' | 'briefing' | 'custom';

function heatIsComplete(heat: Heat): boolean {
  return heat.races.length > 0 && heat.races.every((r) => r.isComplete);
}

function orderedHeats(session: Session): Heat[] {
  return session.heats.slice().sort((a, b) => a.orderIndex - b.orderIndex);
}

/**
 * Race-finals sections explode every race into 3 heats (Q1 / Q2 / Final) tied
 * by `raceRoundId`. The public should only see the Final (the canonical
 * "result" heat) — admins see the full breakdown so they can score Q1/Q2.
 */
function visibleHeats(session: Session, isAdmin: boolean): Heat[] {
  const all = orderedHeats(session);
  if (isAdmin) return all;
  return all.filter((h) => (h.raceRoundStage ?? 0) !== 1);
}

/** Strip "· Q1 / · Q2 / · Final" suffix for the public view of race-finals heats. */
function publicHeatLabel(heat: Heat, fallback: string): string {
  const raw = heat.label?.trim() || fallback;
  if ((heat.raceRoundStage ?? 0) === 2) {
    // "Bending · Final" → "Bending"; bare "A Final" stays as-is.
    const stripped = raw.replace(/\s*[·\-—]\s*(Final|Race\s*Final)$/i, '');
    return stripped || raw;
  }
  return raw;
}

function sessionTitle(s: Session): string {
  // Prefer the section name (e.g. "Senior Pairs"); fall back to the session's own name.
  const raw = s.sectionName?.trim() || s.name?.trim() || 'Age group';
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
    return `${sectionPart} · ${sessionPart} · ${heatLabel}`;
  }
  return `${sectionPart} · ${heatLabel}`;
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

export function TimetableManagement() {
  const { competition, reload } = useCompetition();
  const { canManage } = useAuth();
  const [addKind, setAddKind] = useState<AddKind | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const [autoRaces, setAutoRaces] = useState(5);
  const [autoSessions, setAutoSessions] = useState(1);
  const [autoLanes, setAutoLanes] = useState(6);
  const [autoMinutes, setAutoMinutes] = useState(15);
  const [finalsOpen, setFinalsOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdResumeTime, setHoldResumeTime] = useState('14:30');
  const [holdDelayMinutes, setHoldDelayMinutes] = useState('30');
  const [holdAnnounce, setHoldAnnounce] = useState(true);
  const [holdBannerText, setHoldBannerText] = useState<string | null>(null);
  const [combineOpen, setCombineOpen] = useState(false);
  const [combineTargetId, setCombineTargetId] = useState<number>(0);
  const [combineSourceId, setCombineSourceId] = useState<number>(0);
  const [combineScoringMode, setCombineScoringMode] = useState<'BySection' | 'Combined'>('BySection');

  const orderedSessions = useMemo(
    () => competition.sessions.slice().sort((a, b) => a.orderIndex - b.orderIndex),
    [competition.sessions]
  );

  const timings = useMemo(() => computeTimings(competition.sessions), [competition.sessions]);

  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const today = dayKey(new Date());
  const sessionDay = (session: Session) => {
    const timing = timings.get(session.id);
    const when = timing?.effective ?? timing?.scheduled;
    return dayKey(when ?? new Date(competition.startDate));
  };
  const days = [...new Set(orderedSessions.map(sessionDay).filter(Boolean))].sort();
  const firstDay = dayKey(new Date(competition.startDate));
  const lastDay = dayKey(new Date(competition.endDate ?? competition.startDate));
  if (today >= firstDay && today <= lastDay && !days.includes(today)) days.push(today);
  if (days.length === 0 && firstDay) days.push(firstDay);
  days.sort();
  const selectedDay = pickedDay && days.includes(pickedDay) ? pickedDay : defaultTimetableDay(days, today);
  const daySessions = orderedSessions.filter((session) => sessionDay(session) === selectedDay);

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

  async function applyHold() {
    const trimmedResume = holdResumeTime.trim();
    const delayVal = Number(holdDelayMinutes) || 0;
    await api.post(`/competitions/${competition.id}/sessions/hold`, {
      resumeTime: trimmedResume || null,
      delayMinutes: trimmedResume ? null : delayVal,
      postAnnouncement: holdAnnounce,
    });
    setHoldBannerText(
      trimmedResume
        ? `Competition on hold — we will continue at ${trimmedResume}`
        : `Competition on hold — delayed by ${delayVal} minutes`,
    );
    setHoldOpen(false);
    reload();
  }

  async function combineSectionsIntoHeat() {
    const targetId = combineTargetId || raceSessions[0]?.id;
    const sourceId = combineSourceId || raceSessions.find((s) => s.id !== targetId)?.id;
    if (!targetId || !sourceId || targetId === sourceId) return;
    await api.post(`/competitions/${competition.id}/sessions/${targetId}/combine-heat`, {
      sourceSessionId: sourceId,
      scoringMode: combineScoringMode,
      removeSourceSession: true,
    });
    setCombineOpen(false);
    reload();
  }

  return (
    <div className="space-y-3">
      {holdBannerText && (
        <div
          data-testid="competition-hold-banner"
          role="status"
          className="flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-100 p-2.5 text-xs font-semibold text-amber-900 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-100"
        >
          <span>{holdBannerText}</span>
          <button
            type="button"
            className="btn-ghost !py-0.5 !px-2 text-[11px]"
            onClick={() => setHoldBannerText(null)}
          >
            Resume / Dismiss
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{selectedDay === today ? 'Today’s timetable' : 'Timetable'}</h1>
        <label className="flex min-h-12 items-center gap-2 text-sm font-medium">
          <CalendarDays className="h-5 w-5 text-brand-600" />
          <span className="sr-only">Timetable day</span>
          <SelectField className="input min-h-12" value={selectedDay} onChange={(e) => setPickedDay(e.target.value)}>
            {days.map((day) => <option key={day} value={day}>{day === today ? 'Today · ' : ''}{new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</option>)}
          </SelectField>
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5 items-start">
        {orderedSessions.some((s) => s.arenaName?.trim()) && (
          <Link
            to="arena"
            className="btn-ghost !py-1.5 !px-2.5 text-xs bg-arena-live/20 text-amber-800 dark:text-amber-100 hover:bg-arena-live/30"
            title="See the current arena setup with race diagrams"
          >
            <Activity className="w-3.5 h-3.5" /> Arena setup
          </Link>
        )}
        <WeatherNow lat={competition.latitude} lon={competition.longitude} />
        <button
          onClick={() => exportTimetableCsv(competition.name, orderedSessions, timings)}
          className="btn-ghost !py-1.5 !px-2.5 text-xs"
          title="Download timetable as CSV"
        >
          <Download className="w-3.5 h-3.5" /> CSV
        </button>
        <div className="ml-auto" />
        {canManage(competition) && (
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
              if (!(await confirmDialog({ title: 'Move sessions forward a day?', message: 'Move all unstarted sessions forward by one day?', confirmLabel: 'Move forward a day', destructive: true }))) return;
              await api.post(`/competitions/${competition.id}/shift-day`, null, { params: { days: 1 } });
              reload();
            }}
            title="Push unstarted sessions to the next day"
          >
            <CalendarDays className="w-3.5 h-3.5" /> Next day
          </button>
          <button
            type="button"
            className="btn-ghost !py-1.5 !px-2.5 text-xs"
            onClick={() => setHoldOpen((v) => !v)}
          >
            <Clock className="w-3.5 h-3.5" /> Hold / Set Resume Time
          </button>
          {raceSessions.length >= 2 && (
            <button
              type="button"
              className="btn-ghost !py-1.5 !px-2.5 text-xs"
              onClick={() => {
                setCombineTargetId((cur) => cur || (raceSessions[0]?.id ?? 0));
                setCombineSourceId((cur) => cur || (raceSessions[1]?.id ?? 0));
                setCombineOpen((v) => !v);
              }}
            >
              <Sparkles className="w-3.5 h-3.5" /> Combine sections
            </button>
          )}
          </>
        )}
      </div>

      {holdOpen && canManage(competition) && (
        <div className="card p-3 space-y-2 text-xs">
          <div className="font-semibold">Competition on hold / custom resume time</div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-slate-500 dark:text-slate-300">Resume time</span>
              <input
                aria-label="Resume time"
                type="text"
                placeholder="e.g. 14:30"
                className="input !py-1 !px-2 text-xs w-28"
                value={holdResumeTime}
                onChange={(e) => setHoldResumeTime(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-slate-500 dark:text-slate-300">Delay minutes</span>
              <input
                aria-label="Delay minutes"
                type="number"
                className="input !py-1 !px-2 text-xs w-24"
                value={holdDelayMinutes}
                onChange={(e) => setHoldDelayMinutes(e.target.value)}
              />
            </label>
            <label className="flex items-center gap-1.5 py-1.5">
              <input
                type="checkbox"
                aria-label="Post hold announcement"
                checked={holdAnnounce}
                onChange={(e) => setHoldAnnounce(e.target.checked)}
              />
              <span>Post announcement</span>
            </label>
            <button type="button" onClick={() => void applyHold()} className="btn-primary !py-1.5 !px-3 text-xs">
              Apply hold
            </button>
          </div>
        </div>
      )}

      {combineOpen && canManage(competition) && raceSessions.length >= 2 && (
        <div className="card p-3 space-y-2 text-xs">
          <div className="font-semibold">Combine small age groups into one heat</div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-slate-500 dark:text-slate-300">Target session</span>
              <select
                aria-label="Target session"
                className="input !py-1 !px-2 text-xs"
                value={combineTargetId || raceSessions[0]?.id}
                onChange={(e) => setCombineTargetId(Number(e.target.value))}
              >
                {raceSessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-slate-500 dark:text-slate-300">Combine with session</span>
              <select
                aria-label="Combine with session"
                className="input !py-1 !px-2 text-xs"
                value={combineSourceId || raceSessions[1]?.id}
                onChange={(e) => setCombineSourceId(Number(e.target.value))}
              >
                {raceSessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-slate-500 dark:text-slate-300">Combined scoring mode</span>
              <select
                aria-label="Combined scoring mode"
                className="input !py-1 !px-2 text-xs"
                value={combineScoringMode}
                onChange={(e) => setCombineScoringMode(e.target.value as 'BySection' | 'Combined')}
              >
                <option value="BySection">Score by section (separate section points)</option>
                <option value="Combined">Score as one combined heat</option>
              </select>
            </label>
            <button type="button" onClick={() => void combineSectionsIntoHeat()} className="btn-primary !py-1.5 !px-3 text-xs">
              Combine into one heat
            </button>
          </div>
        </div>
      )}

      {autoOpen && canManage(competition) && (
        <div className="card p-3 space-y-2">
          <p className="text-xs text-slate-600 dark:text-slate-200">
            One session per section with balanced heats. Replaces existing race sessions.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <label className="flex flex-col">
              <span className="text-slate-500 dark:text-slate-300">Races per heat</span>
              <NumberField  min={1} max={20} className="input !py-1 !px-2 text-sm"
                value={autoRaces} onChange={(e) => setAutoRaces(Math.max(1, parseInt(e.target.value, 10) || 1))} />
            </label>
            <label className="flex flex-col">
              <span className="text-slate-500 dark:text-slate-300">Sessions / section</span>
              <NumberField  min={1} max={10} className="input !py-1 !px-2 text-sm"
                value={autoSessions} onChange={(e) => setAutoSessions(Math.max(1, parseInt(e.target.value, 10) || 1))} />
            </label>
            <label className="flex flex-col">
              <span className="text-slate-500 dark:text-slate-300">Max teams / heat</span>
              <NumberField  min={1} max={20} className="input !py-1 !px-2 text-sm"
                value={autoLanes} onChange={(e) => setAutoLanes(Math.max(1, parseInt(e.target.value, 10) || 1))} />
            </label>
            <label className="flex flex-col">
              <span className="text-slate-500 dark:text-slate-300">Mins / race</span>
              <NumberField  min={1} max={60} className="input !py-1 !px-2 text-sm"
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

      {addKind && canManage(competition) && (
        <AddEntryForm kind={addKind} onCancel={() => setAddKind(null)} onSaved={() => { setAddKind(null); reload(); }} />
      )}

      {anyShift && (
        <div className="text-[11px] text-amber-700 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-md p-1.5 flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3" />
          Times have shifted from the scheduled plan.
        </div>
      )}

      {orderedSessions.length === 0 && (
        <p className="text-slate-500 dark:text-slate-300 text-sm">Nothing scheduled yet.</p>
      )}

      {orderedSessions.length > 0 && daySessions.length === 0 && <p className="card p-4 text-sm text-slate-600 dark:text-slate-300">Nothing scheduled for this day. Choose another day to see more.</p>}
      <ArenaSplitView
        key={selectedDay}
        sessions={daySessions}
        timings={timings}
        onUpdated={reload}
      />

      {canManage(competition) && hasAnyHeats && (
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
  const { competition } = useCompetition();
  const { canManage, canOrganise } = useAuth();
  const isAdmin = canManage(competition);
  // Organisers (admin + trainer + manager) see the full Q1/Q2/Final
  // breakdown of race-finals heats; public viewers see one row per race.
  const showFullBreakdown = canOrganise(competition);
  const allHeats = orderedHeats(session);
  const heats = visibleHeats(session, showFullBreakdown);
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
    if (!(await confirmDialog({ title: 'Fill the finals heats?', message: 'Populate these finals heats with the top teams from standings?', confirmLabel: 'Fill finals heats' }))) return;
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
              {title} · Finals ready to seed
            </div>
            <div className="text-xs text-amber-700 dark:text-amber-200">
              {heats.length} empty {heats.length === 1 ? 'heat' : 'heats'} ({heats.map((h) => h.label).filter(Boolean).join(', ')}). Seed from the current standings when qualifying finishes.
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
            showFullBreakdown={showFullBreakdown}
            onManageHeats={() => setEditingAssignments(true)}
            onUpdated={onUpdated}
          />
        );
      })}
      {editingAssignments && isAdmin && (
        <HeatAssignmentEditor
          session={session}
          heats={allHeats}
          onClose={() => setEditingAssignments(false)}
          onSaved={() => { setEditingAssignments(false); onUpdated(); }}
        />
      )}
    </div>
  );
}

function HeatRow({
  session, heat, heatIndex, timing, isActive, isFirst, isAdmin, showFullBreakdown,
  onManageHeats, onUpdated,
}: {
  session: Session;
  heat: Heat;
  heatIndex: number;
  timing: HeatTiming | undefined;
  isActive: boolean;
  isFirst: boolean;
  isAdmin: boolean;
  showFullBreakdown: boolean;
  onManageHeats: () => void;
  onUpdated: () => void;
}) {
  const navigate = useNavigate();
  const [statusMenu, setStatusMenu] = useState(false);
  const complete = heatIsComplete(heat);
  const defaultLabel = `Heat ${heatIndex + 1}`;
  // Public sees "Bending" instead of "Bending · Final" for race-finals rows.
  // Admin/organiser keeps the "· Final" suffix so they can tell stages apart.
  const heatLabel = showFullBreakdown
    ? (heat.label?.trim() || defaultLabel)
    : publicHeatLabel(heat, defaultLabel);
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

      {/* Lanes preview — shown to any organiser (admin, trainer, manager) so
          the lane assignment is visible without opening the scoring screen.
          Populated automatically from heat.entries; for finals this comes from
          the Q1[1], Q2[1], Q1[2], Q2[2] interleave produced by populate-race-final. */}
      {showFullBreakdown && heat.entries.length > 0 && (
        <div
          className="px-3 pb-2 pt-1.5 border-t border-slate-100 dark:border-slate-700/70 flex flex-wrap gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="text-[10px] uppercase font-bold tracking-wide text-slate-400 self-center mr-1">Lanes</span>
          {heat.entries.slice().sort((a, b) => a.laneIndex - b.laneIndex).map((e) => (
            <span
              key={e.id}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700/60 text-[11px]"
              title={`Lane ${e.laneIndex}: ${e.teamName}`}
            >
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-sm bg-slate-900 text-white text-[9px] font-black tabular-nums">
                {e.laneIndex}
              </span>
              <span className="truncate max-w-[120px]">{e.teamName}</span>
            </span>
          ))}
        </div>
      )}

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
        <NumberField
           min={1} max={20}
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
          Seed a finals session from the current standings.
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
  // The arenas already in use. With more than one, the item can be for a single arena or for all of them ('').
  const arenas = useMemo(
    () => [...new Set(competition.sessions.map((s) => s.arenaName?.trim() ?? '').filter(Boolean))],
    [competition.sessions],
  );
  const [arenaName, setArenaName] = useState('');
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
        arenaName: arenas.length > 1 && arenas.includes(arenaName) ? arenaName : null,
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
          <NumberField
             min={0} max={600}
            className="input mt-1 text-sm"
            value={duration}
            onChange={(e) => setDuration(e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0))}
          />
        </label>
      </div>

      {arenas.length > 1 && (
        <label className="block">
          <span className="text-[11px] text-slate-500 dark:text-slate-300">Arena</span>
          <SelectField className="input mt-1 text-sm" value={arenaName} onChange={(e) => setArenaName(e.target.value)}>
            <option value="">All arenas</option>
            {arenas.map((name) => <option key={name} value={name}>{name}</option>)}
          </SelectField>
        </label>
      )}

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
      // Teams already in a heat keep their lane order and newcomers go on the end, so a heat
      // you haven't touched is sent back exactly as it is and keeps its results.
      const assignments = labels.map((label, i) => {
        const picked = teamsInSession.filter((t) => picks[t.id] === label).map((t) => t.id);
        const kept = [...(heats[i]?.entries ?? [])]
          .sort((a, b) => a.laneIndex - b.laneIndex)
          .map((e) => e.teamId)
          .filter((id) => picked.includes(id));
        return { label, teamIds: [...kept, ...picked.filter((id) => !kept.includes(id))] };
      });
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
        Pick which heat each team runs in. Heats you leave alone keep their results; any heat whose teams change has its results cleared.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-72 overflow-auto">
        {teamsInSession.map((t) => (
          <div key={t.id} className="flex items-center gap-2 px-2 py-1 rounded-md bg-slate-50 dark:bg-slate-800/70">
            <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: bibAccent(t.bib) }} />
            <span className="text-xs flex-1 truncate">{t.name}</span>
            <SelectField
              value={picks[t.id] ?? t.label}
              onChange={(e) => setPicks((cur) => ({ ...cur, [t.id]: e.target.value }))}
              className="input !py-0.5 !px-1 text-xs w-24"
            >
              {labels.map((l) => (<option key={l} value={l}>{l}</option>))}
            </SelectField>
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
  const [lowestFinalFirst, setLowestFinalFirst] = useState(true);
  const [scaffoldOnly, setScaffoldOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [boundary, setBoundary] = useState<FinalsBoundary | null>(null);
  const [boundaryVersion, setBoundaryVersion] = useState(0);
  const [rules, setRules] = useState<Record<number, TieBreakRule>>({});
  const section = sectionId === '' ? null : sections.find((s) => s.id === sectionId) ?? null;

  // Re-check every finals cut whenever the size of the finals, the section or a tie's settlement changes.
  useEffect(() => {
    let cancelled = false;
    const params: Record<string, number> = { topN, lanesPerHeat: lanes };
    if (sectionId !== '') params.sectionId = sectionId;
    api.get<FinalsBoundary>(`/competitions/${competitionId}/finals/boundary`, { params })
      .then((r) => { if (!cancelled) setBoundary(r.data); })
      .catch(() => { if (!cancelled) setBoundary(null); });
    return () => { cancelled = true; };
  }, [competitionId, topN, lanes, sectionId, boundaryVersion]);

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
          lowestFinalFirst,
        });
      } else {
        await api.post(`/competitions/${competitionId}/finals`, {
          competitionSectionId: sectionId === '' ? null : sectionId,
          topN,
          raceNames: races,
          lanesPerHeat: lanes,
          name: name.trim() || null,
          lowestFinalFirst,
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
            <SelectField
              className="input mt-1 text-sm"
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
            >
              <option value="">All age groups (overall)</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>{s.displayName}</option>
              ))}
            </SelectField>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-semibold">Top N teams</span>
              <NumberField
                 min={1} max={64}
                className="input mt-1 text-sm"
                value={topN}
                onChange={(e) => setTopN(Math.max(1, parseInt(e.target.value, 10) || 1))}
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold">Max teams / heat</span>
              <NumberField
                 min={1} max={20}
                className="input mt-1 text-sm"
                value={lanes}
                onChange={(e) => setLanes(Math.max(1, parseInt(e.target.value, 10) || 1))}
              />
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-semibold">Running order</span>
            <SelectField
              className="input mt-1 text-sm"
              value={lowestFinalFirst ? 'lowest' : 'top'}
              onChange={(e) => setLowestFinalFirst(e.target.value === 'lowest')}
            >
              <option value="lowest">Lowest final first (C → B → A)</option>
              <option value="top">Top final first (A → B → C)</option>
            </SelectField>
          </label>

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
              <span className="font-semibold">Create empty finals now, seed teams later.</span>{' '}
              <span className="text-slate-500 dark:text-slate-300">
                Adds the finals session and heats to the timetable now so you can fill the teams from standings once qualifying finishes.
              </span>
            </span>
          </label>

          <FinalsTiePanel
            competitionId={competitionId}
            section={section}
            rule={section ? rules[section.id] ?? section.tieBreakRule ?? TieBreakRule.Countback : TieBreakRule.Countback}
            onRuleChange={(id, rule) => setRules((current) => ({ ...current, [id]: rule }))}
            boundary={boundary}
            onChanged={() => setBoundaryVersion((v) => v + 1)}
          />
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
