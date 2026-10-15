import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import {
  ChevronLeft, CloudOff, Flag, AlertTriangle, Trash2, Trophy, ChevronDown, ChevronUp, Coffee, Wand2, X, Clock, Columns3, ClipboardList, Users, CheckCircle2,
} from 'lucide-react';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import type { DeclarationForm, Heat, HeatEntry, Race, Session } from '../../types';
import { SessionEndTransition } from './SessionEndTransition';
import { bibAccent } from '../../lib/bib';
import { retryOnNetworkError } from '../../lib/liveUpdates';
import { describePlacings, enqueue, placingsOf, type QueuedScore } from '../../offline/scoreOutbox';
import { updateOutbox, useScoreOutbox } from '../../offline/useScoreOutbox';

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
  const [searchParams] = useSearchParams();
  const requestedHeat = Number(searchParams.get('heat'));
  const sid = sessionId ? parseInt(sessionId, 10) : null;
  const { competition, reload } = useCompetition();
  const { canEdit } = useAuth();

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

  const [activeHeatId, setActiveHeatId] = useState<number | null>(() => orderedHeats.find((heat) => heat.id === requestedHeat)?.id ?? firstIncompleteHeatId);
  const [activeRaceId, setActiveRaceId] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingPlace[]>([]);

  // Auto-save the admin's in-progress placings per (heat, race) so a reload
  // doesn't wipe them. Cleared on submit + reset.
  const scoringDraftKey = activeHeatId && activeRaceId
    ? `mg.draft.scoring:${activeHeatId}:${activeRaceId}` : null;
  useEffect(() => {
    if (!scoringDraftKey) return;
    try {
      const raw = localStorage.getItem(scoringDraftKey);
      if (raw) {
        const parsed = JSON.parse(raw) as PendingPlace[];
        if (Array.isArray(parsed)) setPending(parsed);
      }
    } catch { /* ignore */ }
    // Only hydrate when the active race changes — admin's interactive
    // changes are saved by the next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoringDraftKey]);
  useEffect(() => {
    if (!scoringDraftKey) return;
    try {
      if (pending.length === 0) localStorage.removeItem(scoringDraftKey);
      else localStorage.setItem(scoringDraftKey, JSON.stringify(pending));
    } catch { /* quota */ }
  }, [scoringDraftKey, pending]);
  const outbox = useScoreOutbox();
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

  // Results go into this phone's outbox and send when there's signal, so the
  // scorer can move straight on to the next race.
  function submit() {
    if (!activeRace || !activeHeat || !session) return;
    const heatIndex = orderedHeats.findIndex((h) => h.id === activeHeat.id);
    updateOutbox((list) => enqueue(list, {
      raceId: activeRace.id,
      competitionId: session.competitionId,
      sessionId: session.id,
      label: `${activeHeat.label ?? `Heat ${heatIndex + 1}`} · ${activeRace.name}`,
      places: pending,
      expected: placingsOf(activeRace.results),
      teamNames: Object.fromEntries(activeHeat.entries.map((e) => [e.teamId, e.teamName])),
      queuedAt: new Date().toISOString(),
      state: 'waiting',
    }));
    setPending([]);
    const queuedIds = new Set([...outbox.map((q) => q.raceId), activeRace.id]);
    const nextRace = orderedRaces.find((r) => !r.isComplete && !queuedIds.has(r.id));
    if (nextRace) {
      setActiveRaceId(nextRace.id);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Link to=".." className="btn-ghost !py-1.5 !px-2.5 text-xs">
          <ChevronLeft className="w-3.5 h-3.5" /> Sessions
        </Link>
        {canEdit() && (
          <div className="flex gap-1.5">
            <button className="btn-ghost !py-1.5 !px-2.5 text-xs" onClick={() => setShowGenerator(true)}>
              <Wand2 className="w-3.5 h-3.5" /> Set up heats
            </button>
          </div>
        )}
      </div>

      {canEdit() ? (
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
              queued={outbox}
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
        <PublicResultsView heats={orderedHeats} activeHeatId={activeHeatId} />
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
  queued: QueuedScore[];
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
  heat, races, activeRace, onSelectRace, sessionBase, pending, canScore, queued, showResults,
  onToggleResults, showLaneView, onToggleLaneView, onClickTeam, onToggleElim, onReset, onSubmit,
}: ScoringProps) {
  const pendingByTeam = new Map(pending.map((p) => [p.teamId, p]));
  const queuedByRace = new Map(queued.map((q) => [q.raceId, q]));
  const activeQueued = activeRace ? queuedByRace.get(activeRace.id) : undefined;
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
              title={queuedByRace.has(race.id) ? 'Saved on this phone, not sent yet' : undefined}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md whitespace-nowrap text-[11px] font-semibold transition ${
                race.id === activeRace?.id
                  ? 'bg-brand-600 text-white'
                  : queuedByRace.has(race.id)
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                    : race.isComplete
                    ? 'bg-arena-finished/20 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-100'
              }`}
            >
              {queuedByRace.has(race.id) && <CloudOff className="w-3 h-3" aria-label="Not sent yet" />}
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
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="font-semibold flex items-center gap-1.5 text-sm flex-1 min-w-0">
              <Flag className="w-4 h-4 text-brand-600 shrink-0" /> Scoring · {activeRace.name}
            </h3>
            <RaceClock key={activeRace.id} race={activeRace} />
          </div>
          {activeQueued && (
            <p role="status" className="mb-2 rounded-md bg-amber-50 p-2 text-[11px] text-amber-900">
              Not sent yet: {describePlacings(activeQueued.places, activeQueued.teamNames)}. To change them, score the race again.
            </p>
          )}
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
                disabled={pending.length === 0}
                className="btn-primary !py-1.5 !px-3 text-xs ml-auto"
              >
                <Trophy className="w-3.5 h-3.5" />
                {`Save ${pending.length} result${pending.length === 1 ? '' : 's'}`}
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
            <th className="px-2 py-1.5 sticky left-0 bg-white dark:bg-slate-800">Team</th>
            {races.map((r) => (
              <th key={r.id} className="px-2 py-1.5 text-center whitespace-nowrap">{r.name}</th>
            ))}
            <th className="px-2 py-1.5 text-center font-bold">Total</th>
          </tr>
        </thead>
        <tbody>
          {teams.map((t) => {
            const total = races.reduce((sum, r) => sum + (r.results.find((x) => x.teamId === t.teamId)?.points ?? 0), 0);
            return (
              <tr key={t.teamId} className="border-t border-slate-100 dark:border-slate-800">
                <td
                  className="px-2 py-1.5 font-medium sticky left-0 bg-white dark:bg-slate-800 whitespace-nowrap"
                  style={{ borderLeft: `3px solid ${bibAccent(t.bibColour)}` }}
                >
                  {t.teamName}
                </td>
                {races.map((r) => (
                  <td key={r.id} className="px-2 py-1.5 text-center tabular-nums">
                    {cellFor(r, t.teamId)}
                  </td>
                ))}
                <td className="px-2 py-1.5 text-center font-mono font-bold text-brand-700 dark:text-brand-200 tabular-nums border-l border-slate-200 dark:border-slate-700">
                  {total}
                </td>
              </tr>
            );
          })}
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
      <div className="flex items-start gap-2">
        <span
          className={`shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md text-sm font-black tabular-nums ${
            place != null || eliminated
              ? 'bg-white/20 text-white'
              : 'bg-slate-900/90 text-white dark:bg-white dark:text-slate-900'
          }`}
          title={`Lane ${lane}`}
        >
          {lane}
        </span>
        <div className="text-sm leading-tight flex-1 min-w-0">{teamName}</div>
      </div>
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

function PublicResultsView({ heats, activeHeatId }: { heats: Heat[]; activeHeatId: number | null }) {
  const index = Math.max(0, heats.findIndex((heat) => heat.id === activeHeatId));
  const heat = heats[index];
  if (!heat) {
    return <div className="card p-3 text-slate-500 dark:text-slate-300 text-sm">No heats in this session yet.</div>;
  }
  return (
    <div className="space-y-3">
      <h1 className="flex items-center gap-2 text-2xl font-bold">
        <Trophy className="h-6 w-6 shrink-0 text-brand-600" />{heat.label ?? `Heat ${index + 1}`} scores
      </h1>
      <SessionScoresTable heats={[heat]} />
    </div>
  );
}

/**
 * One combined public scores table for the whole session. Teams as rows,
 * distinct race names as columns, points summed across all heats that share
 * the same race name. For race-finals sections this collapses Q1+Q2+Final
 * into a single column per race, so the public never sees the qualifier
 * breakdown unless they expand it.
 */
function SessionScoresTable({ heats }: { heats: Heat[] }) {
  const grid = useMemo(() => {
    const raceNames: string[] = [];
    const raceSet = new Set<string>();
    const teamsById = new Map<number, { id: number; name: string; bib?: string | null }>();
    const cells = new Map<string, { points: number; elim: boolean }>();
    for (const heat of heats) {
      for (const e of heat.entries) {
        if (!teamsById.has(e.teamId)) {
          teamsById.set(e.teamId, { id: e.teamId, name: e.teamName, bib: e.bibColour });
        }
      }
      const races = heat.races.slice().sort((a, b) => a.orderIndex - b.orderIndex);
      for (const race of races) {
        if (!raceSet.has(race.name)) { raceSet.add(race.name); raceNames.push(race.name); }
        for (const r of race.results) {
          if (!teamsById.has(r.teamId)) {
            teamsById.set(r.teamId, { id: r.teamId, name: r.teamName, bib: null });
          }
          const k = `${r.teamId}|${race.name}`;
          const cur = cells.get(k) ?? { points: 0, elim: false };
          cur.points += r.points;
          if (r.eliminated && r.points === 0) cur.elim = true;
          cells.set(k, cur);
        }
      }
    }
    const teams = Array.from(teamsById.values()).map((t) => ({
      ...t,
      total: raceNames.reduce((s, n) => s + (cells.get(`${t.id}|${n}`)?.points ?? 0), 0),
    })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    return { raceNames, teams, cells };
  }, [heats]);

  if (grid.raceNames.length === 0 || grid.teams.length === 0) {
    return (
      <div className="card p-3 text-slate-500 dark:text-slate-300 text-sm">
        No results yet.
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-base sm:text-lg border-collapse">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-slate-600 dark:text-slate-300">
              <th className="text-left font-semibold px-3 py-2 sticky left-0 bg-white dark:bg-slate-800 z-10 min-w-[130px]">Team</th>
              {grid.raceNames.map((n) => (
                <th key={n} className="text-center font-semibold px-2 py-2 max-w-[90px] truncate" title={n}>
                  {n}
                </th>
              ))}
              <th className="text-right font-bold px-3 py-2 text-brand-700 dark:text-brand-200">Total</th>
            </tr>
          </thead>
          <tbody>
            {grid.teams.map((t) => (
              <tr key={t.id} className="border-t border-slate-100 dark:border-slate-700/60">
                <td className="px-3 py-3 font-semibold sticky left-0 bg-white dark:bg-slate-800">
                  {t.name}
                </td>
                {grid.raceNames.map((n) => {
                  const cell = grid.cells.get(`${t.id}|${n}`);
                  return (
                    <td key={n} className="px-2 py-3 text-center font-mono tabular-nums">
                      {cell == null
                        ? <span className="text-slate-300">—</span>
                        : cell.elim && cell.points === 0
                          ? <span className="text-rose-500">0</span>
                          : <span className="font-semibold">{cell.points}</span>}
                    </td>
                  );
                })}
                <td className="px-3 py-3 text-right font-mono text-xl font-bold text-brand-700 dark:text-brand-200 tabular-nums">
                  {t.total}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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

/**
 * Live race clock — Start/Stop buttons + an elapsed timer that ticks every
 * second while the race is running. Optimistic: shows the tap at once and
 * sends the tap time, so a slow connection doesn't shift the race time.
 */
function RaceClock({ race: serverRace }: { race: Race }) {
  type Action = 'start' | 'stop';
  interface Tap { action: Action; at: string; startedAt: string | null; finishedAt: string | null; unsent: boolean; basis: string }
  // The tap waiting on (or confirmed by) the server. It applies only while the
  // live competition data still shows what was on screen when it was tapped.
  const [tap, setTap] = useState<Tap | null>(null);
  const basis = `${serverRace.startedAt ?? ''}|${serverRace.finishedAt ?? ''}`;
  const pendingTap = tap?.basis === basis ? tap : null;
  const race = pendingTap ? { ...serverRace, startedAt: pendingTap.startedAt, finishedAt: pendingTap.finishedAt } : serverRace;

  const started = race.startedAt ? new Date(race.startedAt) : null;
  const finished = race.finishedAt ? new Date(race.finishedAt) : null;
  const running = started != null && finished == null;
  const [, force] = useState(0);
  useEffect(() => {
    if (!running) return;
    const i = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(i);
  }, [running]);

  function elapsed(): string {
    if (!started) return '—';
    const end = finished?.getTime() ?? Date.now();
    const s = Math.max(0, Math.round((end - started.getTime()) / 1000));
    const m = Math.floor(s / 60);
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  }

  async function send(action: Action, at: string) {
    // A reply only counts for its own tap: Stop may be tapped before Start's reply lands.
    const update = (change: Partial<Tap>) => setTap((t) => (t && t.at === at && t.action === action ? { ...t, ...change } : t));
    update({ unsent: false });
    try {
      const { data } = await retryOnNetworkError(() => api.post<Race>(`/races/${serverRace.id}/${action}`, { at }));
      update({ startedAt: data.startedAt ?? null, finishedAt: data.finishedAt ?? null });
    } catch {
      update({ unsent: true });
    }
  }
  function press(action: Action) {
    const at = new Date().toISOString();
    const startedAt = race.startedAt ?? at;
    setTap({ action, at, startedAt, finishedAt: action === 'start' ? null : at, unsent: false, basis });
    void send(action, at);
  }

  if (race.isComplete) {
    // After results submitted, just show the final duration.
    return started && finished ? (
      <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
        <Clock className="inline w-3 h-3 -mt-px" /> {elapsed()}
      </span>
    ) : null;
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`font-mono tabular-nums font-bold text-sm px-2 py-0.5 rounded-md ${
        running
          ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200 animate-pulse'
          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
      }`}>
        <Clock className="inline w-3 h-3 -mt-px" /> {elapsed()}
      </span>
      {running ? (
        <button onClick={() => press('stop')} className="btn-ghost !py-0.5 !px-1.5 text-[11px] text-rose-600">
          Stop
        </button>
      ) : (
        <button onClick={() => press('start')} className="btn-primary !py-0.5 !px-2 text-[11px]">
          Start
        </button>
      )}
      {pendingTap?.unsent && (
        <button role="alert" onClick={() => void send(pendingTap.action, pendingTap.at)} className="btn-ghost !py-0.5 !px-1.5 text-[11px] text-amber-700">
          Not sent · Retry
        </button>
      )}
    </span>
  );
}
