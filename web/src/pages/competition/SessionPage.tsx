import { useParams, Link } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import {
  ChevronLeft, Flag, AlertTriangle, Trash2, Trophy, ChevronDown, ChevronUp, Coffee, Wand2, X, Clock, Columns3, ClipboardList, Users, CheckCircle2,
} from 'lucide-react';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import { ForecastBadge } from '../../components/ForecastBadge';
import type { DeclarationForm, Heat, HeatEntry, Race, Session } from '../../types';
import { SessionEndTransition } from './SessionEndTransition';
import { bibAccent } from '../../lib/bib';
import { displaySectionName } from '../../lib/section';

function displayLaneFor(baseLane: number, raceIndex: number, heatSize: number): number {
  if (heatSize <= 0) return baseLane;
  return ((baseLane - 1 + raceIndex) % heatSize) + 1;
}

function teamForDisplayLane(heat: Heat, raceIndex: number, displayLane: number): HeatEntry | null {
  const size = heat.entries.length;
  if (size <= 0) return null;
  return heat.entries.find((e) => displayLaneFor(e.laneIndex, raceIndex, size) === displayLane) ?? null;
}

interface PendingPlace {
  teamId: number;
  place: number;
  eliminated: boolean;
}

function formatTime(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function heatStartTime(session: Session, heat: Heat, heatIndex: number): Date | null {
  if (heat.startedAt) return new Date(heat.startedAt);
  const baseStr = session.scheduledStart;
  if (!baseStr) return null;
  const base = new Date(baseStr);
  const heatMinutes = heat.durationMinutes
    ?? (session.minutesPerHeat ? session.minutesPerHeat * heat.races.length : null);
  if (!heatMinutes) return new Date(base.getTime() + heatIndex * 30 * 60_000);
  return new Date(base.getTime() + heatIndex * heatMinutes * 60_000);
}

function heatIsComplete(heat: Heat): boolean {
  return heat.races.length > 0 && heat.races.every((r) => r.isComplete);
}

export function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const sid = sessionId ? parseInt(sessionId, 10) : null;
  const { competition, reload } = useCompetition();
  const { hasRole } = useAuth();

  const session = useMemo<Session | null>(
    () => competition.sessions.find((s) => s.id === sid) ?? null,
    [competition, sid]
  );

  const sessionBase = useMemo(() => {
    if (!session) return 0;
    return session.heats.reduce((m, h) => Math.max(m, h.entries.length), 0);
  }, [session]);

  const orderedHeats = useMemo(
    () => (session?.heats ?? []).slice().sort((a, b) => a.orderIndex - b.orderIndex),
    [session]
  );

  const firstIncompleteHeatId = useMemo(
    () => orderedHeats.find((h) => !heatIsComplete(h))?.id ?? orderedHeats[0]?.id ?? null,
    [orderedHeats]
  );

  const [activeHeatId, setActiveHeatId] = useState<number | null>(firstIncompleteHeatId);
  const [activeRaceId, setActiveRaceId] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingPlace[]>([]);
  const [saving, setSaving] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [showTransition, setShowTransition] = useState(false);
  const [showGenerator, setShowGenerator] = useState(false);
  const [showLaneView, setShowLaneView] = useState(false);
  const [decForms, setDecForms] = useState<DeclarationForm[]>([]);

  useEffect(() => {
    if (!session) return;
    api.get<DeclarationForm[]>('/declaration-forms', { params: { competitionId: session.competitionId } })
      .then((r) => setDecForms(r.data))
      .catch(() => setDecForms([]));
  }, [session]);

  const decFormByTeamId = useMemo(() => {
    const m = new Map<number, DeclarationForm>();
    for (const f of decForms) m.set(f.teamId, f);
    return m;
  }, [decForms]);

  const nextUpHeat = useMemo<Heat | null>(() => {
    const activeIdx = orderedHeats.findIndex((h) => !heatIsComplete(h));
    if (activeIdx < 0) return null;
    return orderedHeats[activeIdx + 1] ?? null;
  }, [orderedHeats]);

  useEffect(() => {
    if (activeHeatId == null && firstIncompleteHeatId != null) setActiveHeatId(firstIncompleteHeatId);
  }, [firstIncompleteHeatId, activeHeatId]);

  const activeHeat = orderedHeats.find((h) => h.id === activeHeatId) ?? null;

  const orderedRaces = useMemo(
    () => (activeHeat?.races ?? []).slice().sort((a, b) => a.orderIndex - b.orderIndex),
    [activeHeat]
  );

  useEffect(() => {
    if (!activeHeat) { setActiveRaceId(null); return; }
    // Don't loop back to race 1 when all are complete — leave activeRaceId null so the
    // UI shows "Select a race" and the admin can re-score by clicking a race tab.
    const nextRace = orderedRaces.find((r) => !r.isComplete) ?? null;
    setActiveRaceId(nextRace?.id ?? null);
    setPending([]);
  }, [activeHeat, orderedRaces]);

  // When admin clicks a completed race tab to edit results, pre-fill pending from existing results.
  useEffect(() => {
    if (!activeRaceId) return;
    const race = orderedRaces.find((r) => r.id === activeRaceId);
    if (!race || !race.isComplete) { setPending([]); return; }
    const seeded: PendingPlace[] = race.results
      .slice()
      .sort((a, b) => (a.placing ?? 999) - (b.placing ?? 999))
      .map((r, i) => ({
        teamId: r.teamId,
        place: r.placing ?? i + 1,
        eliminated: r.eliminated,
      }));
    setPending(seeded);
  }, [activeRaceId, orderedRaces]);

  // Detect when the heat the admin is scoring transitions from in-progress → complete,
  // and prompt to advance to the next heat.
  const prevHeatStateRef = useRef<{ id: number; complete: boolean } | null>(null);
  const [heatEndOverlay, setHeatEndOverlay] = useState<{ finishedHeat: Heat; nextHeat: Heat | null } | null>(null);
  useEffect(() => {
    if (!activeHeat) { prevHeatStateRef.current = null; return; }
    const now = { id: activeHeat.id, complete: heatIsComplete(activeHeat) };
    const prev = prevHeatStateRef.current;
    if (prev && prev.id === now.id && !prev.complete && now.complete) {
      const idx = orderedHeats.findIndex((h) => h.id === activeHeat.id);
      const nextHeat = orderedHeats[idx + 1] ?? null;
      setHeatEndOverlay({ finishedHeat: activeHeat, nextHeat });
    }
    prevHeatStateRef.current = now;
  }, [activeHeat, orderedHeats]);

  useEffect(() => {
    if (!session) return;
    if (orderedHeats.length === 0) return;
    const allComplete = orderedHeats.every(heatIsComplete);
    if (allComplete && session.status !== 2) {
      setShowTransition(true);
    }
  }, [session, orderedHeats]);

  if (!session) {
    return (
      <div className="card p-3">
        <Link to=".." className="btn-ghost !py-1.5 !px-2.5 text-xs"><ChevronLeft className="w-3.5 h-3.5" /> Back</Link>
        <p className="mt-3 text-sm">Session not found.</p>
      </div>
    );
  }

  const kind = session.kind ?? (session.isBreak ? 1 : 0);
  if (kind !== 0) {
    return (
      <div className="space-y-3">
        <Link to=".." className="btn-ghost !py-1.5 !px-2.5 text-xs"><ChevronLeft className="w-3.5 h-3.5" /> Back</Link>
        <div className="card p-6 text-center">
          <Coffee className="w-12 h-12 mx-auto text-amber-500 mb-3" />
          <h2 className="text-xl font-bold">{session.name}</h2>
          {session.durationMinutes && (
            <p className="mt-2 text-slate-600 dark:text-slate-300">{session.durationMinutes} minute{kind === 1 ? ' break' : ''}</p>
          )}
          {session.location && (
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">{session.location}</p>
          )}
          {session.notes && (
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{session.notes}</p>
          )}
        </div>
      </div>
    );
  }

  const activeRace = orderedRaces.find((r) => r.id === activeRaceId) ?? null;

  function clickTeam(teamId: number) {
    if (!activeRace) return;
    setPending((cur) => {
      if (cur.some((p) => p.teamId === teamId)) {
        return cur.filter((p) => p.teamId !== teamId).map((p, i) => ({ ...p, place: i + 1 }));
      }
      return [...cur, { teamId, place: cur.length + 1, eliminated: false }];
    });
  }

  function toggleElim(teamId: number) {
    setPending((cur) => {
      const existing = cur.find((p) => p.teamId === teamId);
      if (existing) {
        return cur.map((p) => p.teamId === teamId ? { ...p, eliminated: !p.eliminated } : p);
      }
      return [...cur, { teamId, place: cur.length + 1, eliminated: true }];
    });
  }

  function resetPending() { setPending([]); }

  async function submit() {
    if (!activeRace || !activeHeat || !session) return;
    setSaving(true);
    try {
      await api.post<Heat>(`/races/${activeRace.id}/results`, { places: pending });
      setPending([]);
      reload();
      const nextRace = orderedRaces.find((r) => !r.isComplete && r.id !== activeRace.id);
      if (nextRace) {
        setActiveRaceId(nextRace.id);
      }
    } finally {
      setSaving(false);
    }
  }


  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Link to=".." className="btn-ghost !py-1.5 !px-2.5 text-xs">
          <ChevronLeft className="w-3.5 h-3.5" /> Sessions
        </Link>
        {hasRole('Admin') && (
          <div className="flex gap-1.5">
            <button className="btn-ghost !py-1.5 !px-2.5 text-xs" onClick={() => setShowGenerator(true)}>
              <Wand2 className="w-3.5 h-3.5" /> Set up heats
            </button>
          </div>
        )}
      </div>

      <div className="card p-3">
        <div className="flex items-start gap-2 flex-wrap">
          <div className="flex-1 min-w-0">
            <h2 className="text-base sm:text-lg font-bold truncate">{session.name}</h2>
            <span className="text-[11px] text-slate-500 dark:text-slate-300">{displaySectionName(session.sectionName)}</span>
          </div>
          <ForecastBadge lat={competition.latitude} lon={competition.longitude} date={session.scheduledStart ?? competition.startDate} />
          <span className="pill bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-200">
            1st = {sessionBase} pts
          </span>
        </div>
      </div>

      {nextUpHeat && (
        <NextUpCard heat={nextUpHeat} decFormByTeamId={decFormByTeamId} />
      )}

      {hasRole('Admin') ? (
        <>
          <HeatTabs
            session={session}
            heats={orderedHeats}
            activeHeatId={activeHeatId}
            onSelect={(id) => { setActiveHeatId(id); setPending([]); }}
          />

          {activeHeat ? (
            <ScoringSection
              heat={activeHeat}
              races={orderedRaces}
              activeRace={activeRace}
              onSelectRace={(id) => { setActiveRaceId(id); setPending([]); }}
              sessionBase={sessionBase}
              pending={pending}
              canScore
              saving={saving}
              showResults={showResults}
              onToggleResults={() => setShowResults((s) => !s)}
              showLaneView={showLaneView}
              onToggleLaneView={() => setShowLaneView((s) => !s)}
              onClickTeam={clickTeam}
              onToggleElim={toggleElim}
              onReset={resetPending}
              onSubmit={submit}
            />
          ) : (
            <div className="card p-3 text-slate-500 dark:text-slate-300 text-sm">No heats in this session yet.</div>
          )}
        </>
      ) : (
        <PublicResultsView session={session} heats={orderedHeats} />
      )}

      <AnimatePresence>
        {heatEndOverlay && (
          <HeatEndOverlay
            finishedHeat={heatEndOverlay.finishedHeat}
            nextHeat={heatEndOverlay.nextHeat}
            decFormByTeamId={decFormByTeamId}
            onAdvance={() => {
              const { nextHeat } = heatEndOverlay;
              setHeatEndOverlay(null);
              if (nextHeat) setActiveHeatId(nextHeat.id);
            }}
            onClose={() => setHeatEndOverlay(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showTransition && (
          <SessionEndTransition
            competition={competition}
            finishedSession={session}
            onClose={() => setShowTransition(false)}
            onAdvanced={() => { setShowTransition(false); reload(); }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showGenerator && (
          <GenerateHeatsModal
            session={session}
            onClose={() => setShowGenerator(false)}
            onDone={() => { setShowGenerator(false); reload(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function HeatTabs({ session, heats, activeHeatId, onSelect }: {
  session: Session;
  heats: Heat[];
  activeHeatId: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
      {heats.map((heat, i) => {
        const complete = heatIsComplete(heat);
        const start = heatStartTime(session, heat, i);
        const racesDone = heat.races.filter((r) => r.isComplete).length;
        return (
          <button
            key={heat.id}
            onClick={() => onSelect(heat.id)}
            className={`px-3 py-2 rounded-lg whitespace-nowrap font-semibold text-xs transition min-w-[120px] ${
              heat.id === activeHeatId
                ? 'bg-brand-600 text-white shadow-soft'
                : complete
                  ? 'bg-arena-finished/20 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200'
                  : 'bg-white/70 dark:bg-slate-700 text-slate-700 dark:text-slate-100'
            }`}
          >
            <span className="block leading-tight">{heat.label ?? `Heat ${i + 1}`}</span>
            <span className="block text-[10px] opacity-80 leading-tight font-normal">
              <Clock className="inline w-2.5 h-2.5 -mt-px mr-0.5" />{formatTime(start)} · {racesDone}/{heat.races.length}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function balancedHeatSizes(numTeams: number, maxLanes: number): number[] {
  if (numTeams <= 0 || maxLanes <= 0) return [];
  const heatCount = Math.max(1, Math.ceil(numTeams / maxLanes));
  const base = Math.floor(numTeams / heatCount);
  const remainder = numTeams % heatCount;
  return Array.from({ length: heatCount }, (_, i) => base + (i < remainder ? 1 : 0));
}

interface GeneratorProps {
  session: Session;
  onClose: () => void;
  onDone: () => void;
}

function GenerateHeatsModal({ session, onClose, onDone }: GeneratorProps) {
  const { competition } = useCompetition();
  const sectionTeams = useMemo(
    () => competition.teams.filter((t) => session.competitionSectionId == null || t.competitionSectionId === session.competitionSectionId),
    [competition.teams, session.competitionSectionId]
  );
  const [decForms, setDecForms] = useState<DeclarationForm[] | null>(null);
  const [decFormsLoading, setDecFormsLoading] = useState(true);

  useEffect(() => {
    setDecFormsLoading(true);
    api.get<DeclarationForm[]>('/declaration-forms', { params: { competitionId: competition.id } })
      .then((r) => setDecForms(r.data))
      .catch(() => setDecForms([]))
      .finally(() => setDecFormsLoading(false));
  }, [competition.id]);

  const decdTeamIds = useMemo(() => new Set((decForms ?? []).map((f) => f.teamId)), [decForms]);
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    if (decFormsLoading) return;
    const defaults = sectionTeams.filter((t) => decdTeamIds.has(t.id)).map((t) => t.id);
    setSelected(new Set(defaults.length > 0 ? defaults : sectionTeams.map((t) => t.id)));
  }, [decFormsLoading, sectionTeams, decdTeamIds]);

  const groupedByClub = useMemo(() => {
    const visible = sectionTeams.filter((t) => showAll || decdTeamIds.has(t.id));
    const m = new Map<string, typeof sectionTeams>();
    for (const t of visible) {
      const key = t.clubName ?? '—';
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(t);
    }
    return Array.from(m.entries())
      .map(([club, ts]) => ({ club, teams: ts.slice().sort((a, b) => a.suffix.localeCompare(b.suffix)) }))
      .sort((a, b) => a.club.localeCompare(b.club));
  }, [sectionTeams, decdTeamIds, showAll]);

  const [races, setRaces] = useState('Litter Lifter\nFlag\nBottle\nMug\nBall and Cone');
  const [lanes, setLanes] = useState<number>(session.lanesPerHeat ?? 6);
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);

  function toggle(id: number) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function submit() {
    const raceNames = races.split('\n').map((r) => r.trim()).filter(Boolean);
    if (selected.size === 0 || raceNames.length === 0) return;
    setBusy(true);
    try {
      await api.post(`/competitions/${competition.id}/sessions/${session.id}/generate-heats`, {
        teamIds: Array.from(selected),
        raceNames,
        lanesPerHeat: lanes,
        replaceExisting: replace,
      });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  const sizes = balancedHeatSizes(selected.size, Math.max(1, lanes));
  const raceCount = races.split('\n').map((r) => r.trim()).filter(Boolean).length || 0;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm grid place-items-center p-3"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }}
        className="card w-full max-w-xl max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 p-3 border-b border-slate-200 dark:border-slate-800">
          <Wand2 className="w-4 h-4 text-brand-600" />
          <h3 className="font-semibold text-sm flex-1">Set up heats</h3>
          <button onClick={onClose} className="btn-ghost !py-1 !px-1.5"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-3 space-y-3">
          <div>
            <div className="flex items-end justify-between gap-2 flex-wrap">
              <label className="text-xs font-semibold">
                Teams ({selected.size} selected)
                <span className="ml-1 font-normal text-[11px] text-slate-500 dark:text-slate-300">
                  <ClipboardList className="inline w-3 h-3 mr-0.5 -mt-px" />
                  {decForms ? `${decForms.length} dec form${decForms.length === 1 ? '' : 's'} in` : 'loading…'}
                </span>
              </label>
              <div className="flex gap-2 items-center">
                <label className="flex items-center gap-1 text-[11px] cursor-pointer">
                  <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
                  Show teams without dec forms
                </label>
                <button
                  className="text-[11px] underline"
                  onClick={() => setSelected(new Set(groupedByClub.flatMap((g) => g.teams).map((t) => t.id)))}
                >All</button>
                <button className="text-[11px] underline" onClick={() => setSelected(new Set())}>None</button>
              </div>
            </div>
            <div className="mt-1.5 space-y-1.5 max-h-56 overflow-auto p-1.5 border border-slate-200 dark:border-slate-700 rounded-lg">
              {decFormsLoading && (
                <span className="text-[11px] text-slate-500">Loading dec forms…</span>
              )}
              {!decFormsLoading && groupedByClub.length === 0 && (
                <span className="text-[11px] text-slate-500">
                  No {showAll ? '' : 'declared '}teams in this section.
                </span>
              )}
              {groupedByClub.map((g) => (
                <div key={g.club}>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold px-1">{g.club}</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                    {g.teams.map((t) => {
                      const hasDec = decdTeamIds.has(t.id);
                      return (
                        <label
                          key={t.id}
                          className={`flex items-center gap-1.5 text-xs cursor-pointer px-1 py-0.5 rounded ${hasDec ? '' : 'opacity-60'}`}
                          title={hasDec ? 'Dec form submitted' : 'No dec form yet'}
                        >
                          <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} />
                          <span className="truncate flex items-center gap-1">
                            <span
                              className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                              style={{ background: bibAccent(t.bibColour) }}
                            />
                            {t.suffix || t.displayName}
                            {!hasDec && <span className="text-[9px] text-amber-600">⚠</span>}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="text-xs font-semibold">Race names (one per line)</span>
            <textarea
              rows={5}
              className="input mt-1 text-sm font-mono"
              value={races}
              onChange={(e) => setRaces(e.target.value)}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-semibold">Max teams per heat</span>
              <input
                type="number" min={1} max={20}
                className="input mt-1 text-sm"
                value={lanes}
                onChange={(e) => setLanes(Math.max(1, parseInt(e.target.value, 10) || 1))}
              />
            </label>
            <label className="flex items-end gap-1.5 text-xs">
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
              Replace existing heats
            </label>
          </div>

          <div className="text-[11px] text-slate-600 dark:text-slate-200 bg-slate-100/60 dark:bg-slate-800/60 rounded-md p-2">
            {sizes.length === 0
              ? 'Pick at least one team.'
              : <>
                  Will create <span className="font-semibold">{sizes.length}</span> heat{sizes.length === 1 ? '' : 's'} of{' '}
                  <span className="font-semibold">{sizes.join(', ')}</span> teams,
                  each running {raceCount} race{raceCount === 1 ? '' : 's'}.
                  Lanes are randomly assigned then rotate by 1 every race within a heat.
                </>
            }
          </div>
        </div>

        <div className="flex items-center gap-2 p-3 border-t border-slate-200 dark:border-slate-800">
          <button onClick={onClose} className="btn-ghost !py-1.5 !px-3 text-xs">Cancel</button>
          <button
            onClick={submit}
            disabled={busy || selected.size === 0 || raceCount === 0}
            className="btn-primary !py-1.5 !px-3 text-xs ml-auto"
          >
            <Wand2 className="w-3.5 h-3.5" /> {busy ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function LaneGrid({ heat, raceIndex, raceName }: { heat: Heat; raceIndex: number; raceName: string }) {
  const size = heat.entries.length;
  if (size === 0) return null;
  const lanes = Array.from({ length: size }, (_, i) => i + 1);
  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-700 p-2 bg-slate-50/60 dark:bg-slate-800/40">
      <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-300 mb-1 flex items-center gap-1">
        <Columns3 className="w-3 h-3" /> Lanes for {raceName} {raceIndex > 0 && <span className="font-normal text-slate-400">(rotated +{raceIndex})</span>}
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
        {lanes.map((laneNum) => {
          const team = teamForDisplayLane(heat, raceIndex, laneNum);
          return (
            <div
              key={laneNum}
              className="flex items-center gap-1.5 px-1.5 py-1 rounded bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-[11px]"
              style={{ borderLeft: `4px solid ${bibAccent(team?.bibColour)}` }}
            >
              <span className="font-mono font-bold w-4 text-slate-500">{laneNum}</span>
              <span className="truncate font-medium">{team?.teamName ?? '—'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ScoringProps {
  heat: Heat;
  races: Race[];
  activeRace: Race | null;
  onSelectRace: (id: number) => void;
  sessionBase: number;
  pending: PendingPlace[];
  canScore: boolean;
  saving: boolean;
  showResults: boolean;
  onToggleResults: () => void;
  showLaneView: boolean;
  onToggleLaneView: () => void;
  onClickTeam: (teamId: number) => void;
  onToggleElim: (teamId: number) => void;
  onReset: () => void;
  onSubmit: () => void;
}

function ScoringSection({
  heat, races, activeRace, onSelectRace, sessionBase, pending, canScore, saving, showResults,
  onToggleResults, showLaneView, onToggleLaneView, onClickTeam, onToggleElim, onReset, onSubmit,
}: ScoringProps) {
  const pendingByTeam = new Map(pending.map((p) => [p.teamId, p]));
  const activeRaceIdx = activeRace ? races.findIndex((r) => r.id === activeRace.id) : 0;
  const heatSize = heat.entries.length;

  function pointsFor(place: number, eliminated: boolean) {
    if (eliminated) return 0;
    if (place < 1 || place > sessionBase) return 0;
    return sessionBase - place + 1;
  }

  return (
    <section className="space-y-3">
      <div className="card p-3 space-y-2">
        <div className="flex items-center gap-1.5 overflow-x-auto -mx-1 px-1 pb-1">
          {races.length === 0 && (
            <span className="text-[11px] text-slate-500 dark:text-slate-300">No races in this heat yet.</span>
          )}
          {races.map((race, i) => (
            <button
              key={race.id}
              onClick={() => onSelectRace(race.id)}
              className={`px-2.5 py-1 rounded-md whitespace-nowrap text-[11px] font-semibold transition ${
                race.id === activeRace?.id
                  ? 'bg-brand-600 text-white'
                  : race.isComplete
                    ? 'bg-arena-finished/20 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-100'
              }`}
            >
              {i + 1}. {race.name}
            </button>
          ))}
        </div>
        {races.length > 0 && (
          <div className="flex justify-end">
            <button
              onClick={onToggleLaneView}
              className={`btn-ghost !py-1 !px-2 text-[11px] ${showLaneView ? 'bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-200' : ''}`}
              title="Show lane order"
            >
              <Columns3 className="w-3.5 h-3.5" /> {showLaneView ? 'Hide lanes' : 'Lane view'}
            </button>
          </div>
        )}
        {showLaneView && activeRace && heatSize > 0 && (
          <LaneGrid heat={heat} raceIndex={activeRaceIdx} raceName={activeRace.name} />
        )}
      </div>

      {activeRace ? (
        <div className="card p-3">
          <h3 className="font-semibold mb-1 flex items-center gap-1.5 text-sm">
            <Flag className="w-4 h-4 text-brand-600" /> Scoring · {activeRace.name}
          </h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-300 mb-3">
            Tap a team to assign its place · swipe a tile <span className="font-semibold">downwards</span> to eliminate (0 pts).
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {heat.entries.map((e) => {
              const state = pendingByTeam.get(e.teamId);
              const lane = displayLaneFor(e.laneIndex, activeRaceIdx, heatSize);
              return (
                <ScoreTile
                  key={e.id}
                  teamName={e.teamName}
                  lane={lane}
                  colour={bibAccent(e.bibColour)}
                  place={state?.eliminated ? undefined : state?.place}
                  eliminated={state?.eliminated ?? false}
                  disabled={!canScore}
                  onTap={() => onClickTeam(e.teamId)}
                  onSwipeEliminate={() => onToggleElim(e.teamId)}
                />
              );
            })}
          </div>
          {canScore && (
            <div className="mt-3 flex gap-2">
              <button onClick={onReset} className="btn-ghost !py-1.5 !px-2.5 text-xs">
                <Trash2 className="w-3.5 h-3.5" /> Clear
              </button>
              <button
                onClick={onSubmit}
                disabled={saving || pending.length === 0}
                className="btn-primary !py-1.5 !px-3 text-xs ml-auto"
              >
                <Trophy className="w-3.5 h-3.5" />
                {saving ? 'Saving…' : `Save ${pending.length} result${pending.length === 1 ? '' : 's'}`}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="card p-3 text-[11px] text-slate-500 dark:text-slate-300">Select a race to score.</div>
      )}

      <div className="card">
        <button
          onClick={onToggleResults}
          className="w-full flex items-center justify-between p-3 text-sm font-semibold"
        >
          <span>Heat results — {heat.label ?? 'Heat'}</span>
          {showResults ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        <AnimatePresence initial={false}>
          {showResults && (
            <motion.div
              initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
              className="overflow-hidden"
            >
              <HeatResultsTable heat={heat} pending={pending} activeRaceId={activeRace?.id ?? null} pointsFor={pointsFor} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

function HeatResultsTable({ heat, pending, activeRaceId, pointsFor }: {
  heat: Heat;
  pending: PendingPlace[];
  activeRaceId: number | null;
  pointsFor: (place: number, eliminated: boolean) => number;
}) {
  const races = heat.races.slice().sort((a, b) => a.orderIndex - b.orderIndex);
  const teams = heat.entries.slice().sort((a, b) => a.laneIndex - b.laneIndex);

  function cellFor(race: Race, teamId: number) {
    if (race.id === activeRaceId) {
      const p = pending.find((x) => x.teamId === teamId);
      if (p) {
        return <span className={p.eliminated ? 'text-rose-600' : 'font-semibold text-brand-700 dark:text-brand-200'}>
          {p.eliminated ? '0' : `${p.place} (${pointsFor(p.place, false)})`}
        </span>;
      }
    }
    const r = race.results.find((x) => x.teamId === teamId);
    if (!r) return <span className="text-slate-400">—</span>;
    if (r.eliminated) return <span className="text-rose-500">0</span>;
    return <span className="font-semibold">{r.points}</span>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs sm:text-sm border-t border-slate-100 dark:border-slate-800">
        <thead>
          <tr className="text-left text-slate-500 dark:text-slate-400">
            <th className="px-2 py-1.5 sticky left-0 bg-white dark:bg-slate-800">Race</th>
            {teams.map((t) => (
              <th key={t.teamId} className="px-2 py-1.5 text-center whitespace-nowrap"
                  style={{ borderBottom: `3px solid ${bibAccent(t.bibColour)}` }}>
                {t.teamName}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {races.map((r) => (
            <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
              <td className="px-2 py-1.5 font-medium sticky left-0 bg-white dark:bg-slate-800">{r.name}</td>
              {teams.map((t) => (
                <td key={t.teamId} className="px-2 py-1.5 text-center tabular-nums">
                  {cellFor(r, t.teamId)}
                </td>
              ))}
            </tr>
          ))}
          <tr className="border-t-2 border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60">
            <td className="px-2 py-1.5 font-bold">Total</td>
            {teams.map((t) => {
              const total = races.reduce((sum, r) => sum + (r.results.find((x) => x.teamId === t.teamId)?.points ?? 0), 0);
              return (
                <td key={t.teamId} className="px-2 py-1.5 text-center font-mono font-bold text-brand-700 dark:text-brand-200 tabular-nums">
                  {total}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

interface ScoreTileProps {
  teamName: string;
  lane: number;
  colour: string;
  place?: number;
  eliminated: boolean;
  disabled: boolean;
  onTap: () => void;
  onSwipeEliminate: () => void;
}

function ScoreTile({
  teamName, lane, colour, place, eliminated, disabled, onTap, onSwipeEliminate,
}: ScoreTileProps) {
  function handlePanEnd(_e: unknown, info: PanInfo) {
    if (disabled) return;
    if (info.offset.y > 50 && info.velocity.y > 0) {
      onSwipeEliminate();
    }
  }

  const base = 'relative select-none touch-pan-y p-3 rounded-xl text-left font-semibold border-2 transition min-h-[72px]';
  let style = '';
  if (eliminated) {
    style = 'bg-rose-100 border-rose-500 text-rose-900';
  } else if (place != null) {
    style = 'bg-brand-600 border-brand-700 text-white shadow-card';
  } else {
    style = 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-900 dark:text-slate-50';
  }

  return (
    <motion.div
      className={`${base} ${style} ${disabled ? 'opacity-60' : 'cursor-pointer'}`}
      whileTap={!disabled ? { scale: 0.95 } : undefined}
      drag={!disabled ? 'y' : false}
      dragSnapToOrigin
      dragElastic={0.4}
      dragConstraints={{ top: 0, bottom: 80 }}
      onPanEnd={handlePanEnd}
      onTap={!disabled ? onTap : undefined}
      style={!place && !eliminated ? { borderLeft: `6px solid ${colour}` } : undefined}
    >
      <div className="text-sm leading-tight">{teamName}</div>
      <div className="text-[10px] opacity-80 mt-0.5">Lane {lane}</div>
      {!place && !eliminated && !disabled && (
        <div className="absolute bottom-1 right-2 text-[9px] opacity-40 font-normal">swipe ↓ elim</div>
      )}
      <AnimatePresence>
        {place != null && !eliminated && (
          <motion.div
            key="place"
            initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
            className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-amber-400 text-amber-900 grid place-items-center font-bold shadow-card text-sm"
          >
            {place}
          </motion.div>
        )}
        {eliminated && (
          <motion.div
            key="elim"
            initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
            className="absolute -top-2 -right-2 px-1.5 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center gap-1"
          >
            <AlertTriangle className="w-2.5 h-2.5" /> ELIM
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function PublicResultsView({ session, heats }: { session: Session; heats: Heat[] }) {
  if (heats.length === 0) {
    return <div className="card p-3 text-slate-500 dark:text-slate-300 text-sm">No heats in this session yet.</div>;
  }
  return (
    <div className="space-y-3">
      {heats.map((heat, i) => (
        <HeatPublicTable key={heat.id} heat={heat} index={i} session={session} />
      ))}
    </div>
  );
}

export function HeatPublicTable({ heat, index, session }: { heat: Heat; index: number; session: Session }) {
  const races = heat.races.slice().sort((a, b) => a.orderIndex - b.orderIndex);
  const teams = heat.entries.slice().sort((a, b) => a.laneIndex - b.laneIndex);
  const start = heatStartTime(session, heat, index);

  const totals = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of races) {
      for (const res of r.results) {
        m.set(res.teamId, (m.get(res.teamId) ?? 0) + res.points);
      }
    }
    return m;
  }, [races]);

  function cellPoints(r: Race, teamId: number) {
    const res = r.results.find((x) => x.teamId === teamId);
    if (!res) return <span className="text-slate-400">—</span>;
    if (res.eliminated) return <span className="text-rose-500">0</span>;
    return <span className="font-semibold">{res.points}</span>;
  }

  function shortLabel(name: string): string {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 3);
    const tail = parts[parts.length - 1];
    if (/^[A-Z0-9]{1,3}$/.test(tail)) return parts[0].slice(0, 3) + tail;
    return parts.map((p) => p[0] ?? '').join('').slice(0, 4).toUpperCase();
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-2 py-1 border-b border-slate-100 dark:border-slate-800 flex items-center gap-1.5 flex-wrap text-[11px]">
        <Trophy className="w-3.5 h-3.5 text-brand-600 shrink-0" />
        <h3 className="font-semibold flex-1 truncate">{heat.label ?? `Heat ${index + 1}`}</h3>
        <span className="text-slate-500 dark:text-slate-300 flex items-center gap-0.5 shrink-0">
          <Clock className="w-2.5 h-2.5" />{formatTime(start)}
        </span>
        <span className="text-slate-400 shrink-0 tabular-nums">{teams.length}t · {races.length}r</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] tabular-nums">
          <thead>
            <tr className="text-slate-600 dark:text-slate-200">
              <th className="px-1.5 py-1 text-left sticky left-0 bg-white dark:bg-slate-800 font-medium">Race</th>
              {teams.map((t) => (
                <th
                  key={t.teamId}
                  className="px-1 py-1 text-center"
                  style={{ borderBottom: `2px solid ${bibAccent(t.bibColour)}` }}
                  title={t.teamName}
                >
                  {shortLabel(t.teamName)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {races.map((r, i) => (
              <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-1.5 py-0.5 text-left sticky left-0 bg-white dark:bg-slate-800 truncate max-w-[80px]" title={r.name}>
                  {i + 1}. {r.name}
                </td>
                {teams.map((t) => (
                  <td key={t.teamId} className="px-1 py-0.5 text-center">{cellPoints(r, t.teamId)}</td>
                ))}
              </tr>
            ))}
            <tr className="border-t-2 border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60">
              <td className="px-1.5 py-0.5 font-bold sticky left-0 bg-slate-50 dark:bg-slate-900/60">Total</td>
              {teams.map((t) => (
                <td key={t.teamId} className="px-1 py-0.5 text-center font-mono font-bold text-brand-700 dark:text-brand-200">
                  {totals.get(t.teamId) ?? 0}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NextUpCard({ heat, decFormByTeamId }: { heat: Heat; decFormByTeamId: Map<number, DeclarationForm> }) {
  const teams = heat.entries.slice().sort((a, b) => a.laneIndex - b.laneIndex);
  return (
    <motion.div
      initial={{ y: 6, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
      className="rounded-xl border-2 border-dashed border-sky-300 dark:border-sky-700 bg-sky-50/70 dark:bg-sky-900/20 p-3"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-600 text-white text-[10px] font-bold uppercase tracking-wide">
          Up next
        </span>
        <span className="font-bold text-sm sm:text-base text-sky-900 dark:text-sky-100 truncate">
          {heat.label ?? 'Next heat'}
        </span>
        <span className="ml-auto text-[11px] text-sky-700 dark:text-sky-200 inline-flex items-center gap-1">
          <Users className="w-3 h-3" /> {teams.length} team{teams.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {teams.map((t) => {
          const form = decFormByTeamId.get(t.teamId);
          const riders = form?.riders.filter((r) => !r.isReserve) ?? [];
          const reserves = form?.riders.filter((r) => r.isReserve) ?? [];
          return (
            <div key={t.teamId} className="rounded-md bg-white dark:bg-slate-800/70 px-2 py-1.5 text-xs flex gap-2 items-start">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full mt-1 shrink-0"
                style={{ background: bibAccent(t.bibColour) }}
              />
              <div className="min-w-0 flex-1">
                <div className="font-semibold truncate text-sm">{t.teamName}</div>
                {form ? (
                  <div className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug">
                    {riders.length === 0 ? (
                      <span className="text-slate-400 italic">No active riders listed</span>
                    ) : (
                      riders.map((r, i) => (
                        <span key={r.id}>
                          {i > 0 && ', '}
                          <span className={r.isCaptain ? 'font-semibold' : ''}>{r.fullName}</span>
                          {r.horseName && <span className="text-slate-400"> · {r.horseName}</span>}
                        </span>
                      ))
                    )}
                    {reserves.length > 0 && (
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        Reserve: {reserves.map((r) => r.fullName).join(', ')}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-[11px] text-amber-700 dark:text-amber-300 italic inline-flex items-center gap-1">
                    <ClipboardList className="w-3 h-3" /> Dec form not yet submitted
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

/**
 * Pops up when the heat the admin was scoring just finished. Shows the
 * next heat's teams with dec form summaries; "Continue" advances activeHeatId.
 */
function HeatEndOverlay({
  finishedHeat, nextHeat, decFormByTeamId, onAdvance, onClose,
}: {
  finishedHeat: Heat;
  nextHeat: Heat | null;
  decFormByTeamId: Map<number, DeclarationForm>;
  onAdvance: () => void;
  onClose: () => void;
}) {
  const teams = nextHeat ? nextHeat.entries.slice().sort((a, b) => a.laneIndex - b.laneIndex) : [];
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm grid place-items-center p-3"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }}
        className="card w-full max-w-xl max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
          <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-base truncate">{finishedHeat.label ?? 'Heat'} complete</h3>
            <p className="text-xs text-slate-500 dark:text-slate-300">Results are saved.</p>
          </div>
          <button onClick={onClose} className="btn-ghost !py-1 !px-1.5">
            <X className="w-4 h-4" />
          </button>
        </div>

        {nextHeat ? (
          <>
            <div className="p-4 space-y-2">
              <div className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-600 text-white text-[10px] font-bold uppercase">
                  Up next
                </span>
                <span className="font-bold text-base truncate">{nextHeat.label ?? 'Next heat'}</span>
                <span className="ml-auto text-[11px] text-slate-500 inline-flex items-center gap-1">
                  <Users className="w-3 h-3" /> {teams.length} team{teams.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {teams.map((t) => {
                  const form = decFormByTeamId.get(t.teamId);
                  const riders = form?.riders.filter((r) => !r.isReserve) ?? [];
                  return (
                    <div key={t.teamId} className="rounded-md bg-slate-50 dark:bg-slate-800/70 px-2 py-1.5 text-xs flex gap-2 items-start">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full mt-1 shrink-0"
                        style={{ background: bibAccent(t.bibColour) }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold truncate text-sm">{t.teamName}</div>
                        {form ? (
                          <div className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug">
                            {riders.length === 0 ? (
                              <span className="text-slate-400 italic">No active riders listed</span>
                            ) : (
                              riders.slice(0, 4).map((r, i) => (
                                <span key={r.id}>
                                  {i > 0 && ', '}
                                  <span className={r.isCaptain ? 'font-semibold' : ''}>{r.fullName}</span>
                                  {r.horseName && <span className="text-slate-400"> · {r.horseName}</span>}
                                </span>
                              ))
                            )}
                          </div>
                        ) : (
                          <div className="text-[11px] text-amber-700 dark:text-amber-300 italic inline-flex items-center gap-1">
                            <ClipboardList className="w-3 h-3" /> Dec form not yet submitted
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="p-3 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2">
              <button onClick={onClose} className="btn-ghost !py-1.5 !px-3 text-xs">Stay on this heat</button>
              <button onClick={onAdvance} className="btn-primary !py-1.5 !px-3 text-xs ml-auto">
                Continue to {nextHeat.label ?? 'next heat'} <ChevronLeft className="w-3.5 h-3.5 rotate-180" />
              </button>
            </div>
          </>
        ) : (
          <div className="p-4">
            <p className="text-sm text-slate-700 dark:text-slate-200">
              That was the last heat of this session. Click below to wrap up.
            </p>
            <div className="mt-3 flex justify-end">
              <button onClick={onClose} className="btn-primary !py-1.5 !px-3 text-xs">Got it</button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
