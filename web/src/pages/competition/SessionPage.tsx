import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, Coffee, Wand2, X, Clock, ClipboardList, Users, CheckCircle2,
} from 'lucide-react';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import type { DeclarationForm, Heat, Session } from '../../types';
import type { QueuedScore } from '../../offline/scoreOutbox';
import { ScoreAuditPanel } from '../operations/ScoreAuditPanel';
import { SessionEndTransition } from './SessionEndTransition';
import { HeatScores } from './HeatScores';
import { ScoringSection } from './ScoringSection';
import { bibAccent } from '../../lib/bib';
import { enqueue, placingsOf } from '../../offline/scoreOutbox';
import { nextRoundLanes } from '../../lib/nextRoundLanes';
import { sessionPointsBase, withQueuedResults } from '../../lib/queuedView';
import { dropDrafts, pushUndo, undoSave, type UndoEntry } from '../../lib/scoreUndo';
import {
  nextRaceToScore, placesFromResults, readScoringDraft, scoringDraftKey as draftKeyFor, tapTeam, toggleEliminated,
  writeScoringDraft, type PendingPlace,
} from '../../lib/raceScoring';
import { OUTBOX_STORAGE_ERROR, updateOutbox, useScoreOutbox } from '../../offline/useScoreOutbox';
import { LANE_ROTATION_LABELS, LaneRotationMode, type LaneRotationModeValue } from '../../lib/lanes';
import { lanesOf, qualifiersOf, restOfQualifier, sitOutPlaces } from './laneRules';
import { useRaceNotes } from './useRaceNotes';

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
  const { canManage, canOrganise } = useAuth();
  const [saveError, setSaveError] = useState<string | null>(null);

  const session = useMemo<Session | null>(
    () => competition.sessions.find((s) => s.id === sid) ?? null,
    [competition, sid]
  );

  const sessionBase = useMemo(() => {
    if (!session) return 0;
    // A heat with more teams than lanes races only the lanes, so points are out of the lanes, not the teams.
    return sessionPointsBase(session.heats, session.lanesPerHeat);
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
  const [correctionReasons, setCorrectionReasons] = useState<Record<number, string>>({});
  const outbox = useScoreOutbox();
  const [showTransition, setShowTransition] = useState(false);
  const [showGenerator, setShowGenerator] = useState(false);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
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

  // Fall back to the first unfinished heat when none is chosen yet (adjusted during render, not in an effect).
  if (activeHeatId == null && firstIncompleteHeatId != null) setActiveHeatId(firstIncompleteHeatId);

  const activeHeat = orderedHeats.find((h) => h.id === activeHeatId) ?? null;

  const orderedRaces = useMemo(
    () => (activeHeat?.races ?? []).slice().sort((a, b) => a.orderIndex - b.orderIndex),
    [activeHeat]
  );

  const preferredRaceRef = useRef<number | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the race selection when the heat's races change
    if (!activeHeat) { setActiveRaceId(null); return; }
    // Don't loop back to race 1 when all are complete — leave activeRaceId null so the
    // UI shows "Select a race" and the admin can re-score by clicking a race tab.
    const preferred = preferredRaceRef.current;
    preferredRaceRef.current = null;
    const nextRace = orderedRaces.find((r) => r.id === preferred) ?? orderedRaces.find((r) => !r.isComplete) ?? null;
    setActiveRaceId(nextRace?.id ?? null);
  }, [activeHeat, orderedRaces]);

  // The placings being entered belong to one race, so they are stored with that race's draft key.
  // Switching race swaps them, in the same render, for that race's saved draft (a draft always wins)
  // or else nothing. Until the scorer changes something, a finished race simply shows its saved results.
  const scoringDraftKey = activeHeatId && activeRaceId ? draftKeyFor(activeHeatId, activeRaceId) : null;
  const draftRace = orderedRaces.find((r) => r.id === activeRaceId) ?? null;
  // Referee notes aren't in the public results, so staff read them separately when correcting a scored race.
  const savedNotes = useRaceNotes(
    draftRace?.id ?? null, canManage(competition) && draftRace?.isComplete === true,
    draftRace?.results.map((r) => `${r.teamId}:${r.placing}:${r.status ?? 0}`).join(',') ?? '');
  const savedPlaces = useMemo(() => (draftRace?.isComplete ? placesFromResults(draftRace, savedNotes) : []), [draftRace, savedNotes]);
  const [pendingState, setPendingState] = useState<{ key: string | null; places: PendingPlace[]; edited: boolean }>(
    { key: null, places: [], edited: false },
  );
  if (pendingState.key !== scoringDraftKey) {
    const draft = scoringDraftKey ? readScoringDraft(scoringDraftKey) : null;
    setPendingState({ key: scoringDraftKey, places: draft ?? [], edited: draft != null });
  }
  const pending = pendingState.edited ? pendingState.places : savedPlaces;
  function setPending(change: PendingPlace[] | ((current: PendingPlace[]) => PendingPlace[])) {
    setPendingState((cur) => {
      const base = cur.edited ? cur.places : savedPlaces;
      return { key: cur.key, edited: true, places: typeof change === 'function' ? change(base) : change };
    });
  }
  // Auto-save the scorer's placings per (heat, race) so a reload doesn't wipe them.
  useEffect(() => {
    if (scoringDraftKey && pendingState.key === scoringDraftKey && pendingState.edited) {
      writeScoringDraft(scoringDraftKey, pendingState.places);
    }
  }, [scoringDraftKey, pendingState]);

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

  // Offer the end-of-session screen whenever the session or its heats change and every heat is done.
  // Adjusted during render against the last values seen, so closing the screen is not undone on re-render.
  const [transitionChecked, setTransitionChecked] = useState<{ session: Session | null; orderedHeats: Heat[] } | null>(null);
  if (transitionChecked?.session !== session || transitionChecked?.orderedHeats !== orderedHeats) {
    setTransitionChecked({ session, orderedHeats });
    if (session && orderedHeats.length > 0 && orderedHeats.every(heatIsComplete) && session.status !== 2) {
      setShowTransition(true);
    }
  }

  // Saves still waiting on this phone are shown as if sent, so the summary, table and next lanes don't wait for signal.
  const viewHeats = useMemo(() => orderedHeats.map((h) => withQueuedResults(h, outbox, sessionBase)), [orderedHeats, outbox, sessionBase]);
  const viewHeat = viewHeats.find((h) => h.id === activeHeatId) ?? null;
  const viewRaces = useMemo(() => (viewHeat?.races ?? []).slice().sort((a, b) => a.orderIndex - b.orderIndex), [viewHeat]);
  const hcTeamIds = useMemo(() => new Set(competition.teams.filter((t) => t.isHorsConcours).map((t) => t.id)), [competition.teams]);
  // The private reasons for the race the announcer card is about: saved ones from the server, then any still waiting on this phone.
  const summaryRace = [...viewRaces].reverse().find((r) => r.isComplete && r.id !== activeRaceId) ?? null;
  const summarySaved = orderedRaces.find((r) => r.id === summaryRace?.id);
  const savedReasons = useRaceNotes(
    summaryRace?.id ?? null, canManage(competition) && summarySaved?.isComplete === true,
    summarySaved?.results.map((r) => `${r.teamId}:${r.placing}:${r.status ?? 0}`).join(',') ?? '');
  const summaryNotes = useMemo(() => {
    const queued = outbox.find((q) => q.raceId === summaryRace?.id);
    const waiting = Object.fromEntries((queued?.places ?? []).filter((p) => p.refereeNote).map((p) => [p.teamId, p.refereeNote as string]));
    return { ...savedReasons, ...waiting };
  }, [outbox, summaryRace?.id, savedReasons]);

  if (!session) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col items-start gap-3 pt-4">
        <Link to=".." className="mg-btn mg-btn-secondary !min-h-11"><ChevronLeft className="h-4 w-4" /> Timetable</Link>
        <p className="mg-card w-full p-4">Session not found.</p>
      </div>
    );
  }

  const kind = session.kind ?? (session.isBreak ? 1 : 0);
  if (kind !== 0) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col items-start gap-3 pt-4">
        <Link to=".." className="mg-btn mg-btn-secondary !min-h-11"><ChevronLeft className="h-4 w-4" /> Timetable</Link>
        <div className="mg-card w-full p-6 text-center">
          <Coffee className="mx-auto mb-3 h-12 w-12 text-[rgb(var(--mg-late-time))]" />
          <h1 className="mg-h1 mg-h1-sm">{session.name}</h1>
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

  // In a qualifier only the teams that go through to the final need placing. The rest finish on 1 point each,
  // and tapping one of those marks it eliminated instead (0 points).
  const qualifierCap = activeHeat?.raceRoundStage === 1 ? qualifiersOf(session) : null;

  // Each tap, swipe or Clear can be undone, so the placings before it are kept.
  function changePending(change: (current: PendingPlace[]) => PendingPlace[]) {
    if (!activeRace) return;
    const before = pendingState.edited ? pendingState.places : savedPlaces;
    setUndoStack((stack) => pushUndo(stack, { kind: 'draft', raceId: activeRace.id, places: before }));
    setPending(change);
  }

  function clickTeam(teamId: number) {
    changePending((cur) => tapTeam(cur, teamId, qualifierCap));
  }

  function toggleElim(teamId: number) {
    changePending((cur) => toggleEliminated(cur, teamId));
  }

  function resetPending() { changePending(() => []); }

  // Marks a team hors concours, or brings it back. The event reloads so standings and the summary follow at once.
  async function setHc(teamId: number, hc: boolean) {
    try {
      await api.put(`/competitions/${competition.id}/teams/${teamId}`, { isHorsConcours: hc });
      setSaveError(null);
      reload();
    } catch {
      setSaveError('Couldn’t change hors concours. Try again.');
    }
  }

  // Results go into this phone's outbox and send when there's signal, so the
  // scorer can move straight on to the next race. `places` carries the reasons when the sheet asked for them.
  function submit(places: PendingPlace[] = pending) {
    if (!activeRace || !activeHeat || !session) return;
    const reason = correctionReasons[activeRace.id]?.trim();
    if ((activeRace.results.length > 0 || outbox.some((item) => item.raceId === activeRace.id)) && !reason) {
      setSaveError('Add a reason for this correction before saving.');
      return;
    }
    const heatIndex = orderedHeats.findIndex((h) => h.id === activeHeat.id);
    const item: QueuedScore = {
      saveId: crypto.randomUUID(),
      reason,
      raceId: activeRace.id,
      competitionId: session.competitionId,
      sessionId: session.id,
      label: `${activeHeat.label ?? `Heat ${heatIndex + 1}`} · ${activeRace.name}`,
      places: [...places, ...restOfQualifier(activeHeat, places), ...sitOutPlaces(activeHeat, orderedRaces.findIndex((r) => r.id === activeRace.id), lanesOf(session))],
      expected: placingsOf(activeRace.results),
      teamNames: Object.fromEntries(activeHeat.entries.map((e) => [e.teamId, e.teamName])),
      queuedAt: new Date().toISOString(),
      state: 'waiting',
    };
    const queuedBefore = outbox.find((q) => q.raceId === activeRace.id) ?? null;
    const stored = updateOutbox((list) => enqueue(list, item));
    if (!stored) { setSaveError(OUTBOX_STORAGE_ERROR); return; }
    setSaveError(null);
    setUndoStack((stack) => pushUndo(dropDrafts(stack, activeRace.id), { kind: 'save', raceId: activeRace.id, sent: item, queuedBefore, draft: places }));
    if (scoringDraftKey) writeScoringDraft(scoringDraftKey, []);
    setPending([]);
    const queuedIds = new Set([...outbox.map((q) => q.raceId), activeRace.id]);
    const next = nextRaceToScore(orderedHeats, session.raceOrderAlternating === true, { heatId: activeHeat.id, raceId: activeRace.id }, queuedIds);
    if (next) {
      if (next.heatId !== activeHeat.id) {
        // Changing heat resets the race selection (effect above); it should land on this race.
        preferredRaceRef.current = next.raceId;
        setActiveHeatId(next.heatId);
      }
      setActiveRaceId(next.raceId);
    }
  }

  // Undo takes back the last action: a placing, a swipe or Clear on the open race, or else the last save.
  const lastUndo = undoStack[undoStack.length - 1];
  const canUndo = lastUndo != null && (lastUndo.kind === 'save' || lastUndo.raceId === activeRace?.id);
  function undo() {
    if (!lastUndo) return;
    setUndoStack((stack) => stack.slice(0, -1));
    if (lastUndo.kind === 'draft') { setPending(lastUndo.places); return; }
    let restore: PendingPlace[] = [];
    updateOutbox((list) => {
      const result = undoSave(list, lastUndo);
      restore = result.restore;
      return result.outbox;
    });
    const heat = orderedHeats.find((h) => h.races.some((r) => r.id === lastUndo.raceId));
    if (!heat) return;
    preferredRaceRef.current = lastUndo.raceId;
    setActiveHeatId(heat.id);
    setActiveRaceId(lastUndo.raceId);
    setPendingState({ key: draftKeyFor(heat.id, lastUndo.raceId), places: restore, edited: restore.length > 0 });
    if (restore.length === 0) writeScoringDraft(draftKeyFor(heat.id, lastUndo.raceId), []);
  }

  const activeIndex = orderedHeats.findIndex((h) => h.id === activeHeatId);
  const followingHeat = viewHeats[activeIndex + 1]
    ?? competition.sessions.filter((s) => (s.kind ?? 0) === 0 && s.orderIndex > session.orderIndex).sort((a, b) => a.orderIndex - b.orderIndex).find((s) => s.heats.length > 0)?.heats
      .slice().sort((a, b) => a.orderIndex - b.orderIndex)[0]
    ?? null;
  const nextLanes = viewHeat ? nextRoundLanes({ ...session, heats: viewHeats }, viewHeat, followingHeat, qualifiersOf(session)) : null;

  return (
    <div className="space-y-3">
      {saveError && <p role="alert" className="mg-notice">{saveError}</p>}

      {canManage(competition) ? (
        <>
          <HeatTabs
            session={session}
            heats={orderedHeats}
            activeHeatId={activeHeatId}
            onSelect={(id) => { setActiveHeatId(id); setPending([]); setUndoStack((stack) => dropDrafts(stack)); }}
          />

          {viewHeat ? (
            <ScoringSection
              heat={viewHeat}
              races={viewRaces}
              activeRace={viewRaces.find((r) => r.id === activeRaceId) ?? null}
              onSelectRace={(id) => { setActiveRaceId(id); setPending([]); setUndoStack((stack) => dropDrafts(stack)); }}
              sessionBase={sessionBase}
              laneRules={lanesOf(session)}
              qualifiers={qualifiersOf(session)}
              pending={pending}
              canScore
              queued={outbox}
              onClickTeam={clickTeam}
              onToggleElim={toggleElim}
              onReset={resetPending}
              onSubmit={submit}
              onUndo={canUndo ? undo : undefined}
              undoLabel={lastUndo?.kind === 'save' ? 'Undo last save' : 'Undo'}
              allowReasons
              hcTeamIds={hcTeamIds}
              onSetHc={canOrganise(competition) ? setHc : undefined}
              tieRule={competition.sections.find((s) => s.id === session.competitionSectionId)?.tieBreakRule}
              notes={summaryNotes}
              nextLanes={nextLanes}
              correctionReason={activeRace ? correctionReasons[activeRace.id] ?? '' : ''}
              onCorrectionReason={(reason) => { if (activeRace) setCorrectionReasons((current) => ({ ...current, [activeRace.id]: reason })); }}
            />
          ) : (
            <div className="card p-3 text-slate-500 dark:text-slate-300 text-sm">No heats in this session yet.</div>
          )}

          <details className="mg-card p-3">
            <summary className="cursor-pointer font-semibold">Organiser tools</summary>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <LaneRotationControl session={session} onChanged={reload} />
              {orderedHeats.some((h) => h.raceRoundStage) && <QualifiersControl session={session} onChanged={reload} />}
              <button className="btn-ghost !py-1.5 !px-2.5 text-xs" onClick={() => setShowGenerator(true)}>
                <Wand2 className="w-3.5 h-3.5" /> Set up heats
              </button>
            </div>
          </details>
        </>
      ) : (
        <HeatScores session={session} heats={orderedHeats} activeHeatId={activeHeatId} />
      )}

      {canManage(competition) && activeRace && !outbox.some((item) => item.raceId === activeRace.id) && (
        <ScoreAuditPanel raceId={activeRace.id} onChanged={reload} />
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

/** How teams change lane after each race. Saved with the session's other timing settings, which it must carry along. */
function LaneRotationControl({ session, onChanged }: { session: Session; onChanged: () => void }) {
  const [error, setError] = useState(false);
  async function change(mode: LaneRotationModeValue) {
    setError(false);
    try {
      await api.put(`/competitions/${session.competitionId}/sessions/${session.id}/settings`, {
        minutesPerHeat: session.minutesPerHeat ?? null,
        raceOrderAlternating: session.raceOrderAlternating ?? false,
        laneRotationMode: mode,
      });
      onChanged();
    } catch { setError(true); }
  }
  return (
    <label className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300">
      <span>Lanes after each race</span>
      <select
        className="input !min-h-0 !py-1 text-xs"
        value={session.laneRotationMode ?? LaneRotationMode.MoveUp}
        onChange={(e) => void change(Number(e.target.value) as LaneRotationModeValue)}
      >
        {([0, 1, 2] as const).map((mode) => <option key={mode} value={mode}>{LANE_ROTATION_LABELS[mode]}</option>)}
      </select>
      {error && <span role="alert" className="text-rose-600">Not saved</span>}
    </label>
  );
}

/** Heat-heat-final: how many teams go through from each qualifier. The final fills itself from this once both qualifiers are scored. */
function QualifiersControl({ session, onChanged }: { session: Session; onChanged: () => void }) {
  const [error, setError] = useState(false);
  async function change(count: number) {
    setError(false);
    try {
      await api.put(`/competitions/${session.competitionId}/sessions/${session.id}/settings`, {
        minutesPerHeat: session.minutesPerHeat ?? null,
        raceOrderAlternating: session.raceOrderAlternating ?? false,
        qualifiersPerHeat: count,
      });
      onChanged();
    } catch { setError(true); }
  }
  return (
    <label className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300">
      <span>Through to the final</span>
      <select className="input !min-h-0 !py-1 text-xs" value={qualifiersOf(session)} onChange={(e) => void change(Number(e.target.value))}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((count) => <option key={count} value={count}>{count} from each</option>)}
      </select>
      {error && <span role="alert" className="text-rose-600">Not saved</span>}
    </label>
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
  // The forms are stored with the competition they belong to, so they count as loading until
  // the fetch for this competition has finished.
  const [decFormsResult, setDecFormsResult] = useState<{ competitionId: number; forms: DeclarationForm[] } | null>(null);
  const decForms = decFormsResult?.competitionId === competition.id ? decFormsResult.forms : null;
  const decFormsLoading = decForms == null;

  useEffect(() => {
    let cancelled = false;
    api.get<DeclarationForm[]>('/declaration-forms', { params: { competitionId: competition.id } })
      .then((r) => r.data)
      .catch(() => [] as DeclarationForm[])
      .then((forms) => { if (!cancelled) setDecFormsResult({ competitionId: competition.id, forms }); });
    return () => { cancelled = true; };
  }, [competition.id]);

  const decdTeamIds = useMemo(() => new Set((decForms ?? []).map((f) => f.teamId)), [decForms]);
  const [showAll, setShowAll] = useState(false);
  // Nothing is selected until the dec forms are in; then teams with a dec form (or all teams, if none
  // has one). The trainer's own choice replaces that, but only while the teams and forms it was
  // made against are unchanged.
  const defaultSelection = useMemo(() => {
    if (decFormsLoading) return new Set<number>();
    const defaults = sectionTeams.filter((t) => decdTeamIds.has(t.id)).map((t) => t.id);
    return new Set(defaults.length > 0 ? defaults : sectionTeams.map((t) => t.id));
  }, [decFormsLoading, sectionTeams, decdTeamIds]);
  const [choice, setChoice] = useState<{ sectionTeams: typeof sectionTeams; decdTeamIds: Set<number>; selected: Set<number> } | null>(null);
  const selected = choice && choice.sectionTeams === sectionTeams && choice.decdTeamIds === decdTeamIds ? choice.selected : defaultSelection;
  function setSelected(next: Set<number> | ((current: Set<number>) => Set<number>)) {
    setChoice({ sectionTeams, decdTeamIds, selected: typeof next === 'function' ? next(selected) : next });
  }

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
