import { useCallback, useEffect, useMemo, useState } from 'react';
import { CloudOff, Link2Off, RefreshCw } from 'lucide-react';
import { ScoreOutboxPanel } from '../components/ScoreOutboxPanel';
import { ScoringSection, type PendingPlace } from './competition/ScoringSection';
import {
  clearScorerToken, parseScorerSession, readSavedScorerSession, readSavedScorerSessionAt, readScorerToken, scorerApi, scorerFailure,
  tokenFromHash, writeSavedScorerSession, writeScorerToken, type ScorerLoadFailure,
} from '../offline/scorerLink';
import { LIVE_SAVED_COPY_NOTICE_AFTER_MS, lastUpdatedText, shouldNoticeSavedCopy } from '../offline/savedCopies';
import { enqueue, placingsOf, type QueuedScore } from '../offline/scoreOutbox';
import { nextRoundLanes } from '../lib/nextRoundLanes';
import { sessionPointsBase, withQueuedResults } from '../lib/queuedView';
import { dropDrafts, pushUndo, undoSave, type UndoEntry } from '../lib/scoreUndo';
import { nextRaceToScore, placesFromResults, tapTeam, toggleEliminated } from '../lib/raceScoring';
import { lanesOf, qualifiersOf, restOfQualifier, sitOutPlaces } from './competition/laneRules';
import { HEAT_SAVED, OUTBOX_STORAGE_ERROR, updateOutbox, useScoreOutbox } from '../offline/useScoreOutbox';
import type { Heat, ScorerSession, Session } from '../types';

/** Takes the token from the address (`/score#t=…`), keeps it on this phone and tidies the address bar. */
function captureToken(): string | null {
  const fromAddress = tokenFromHash(window.location.hash);
  if (fromAddress) {
    writeScorerToken(fromAddress);
    window.history.replaceState(null, '', window.location.pathname);
    return fromAddress;
  }
  return readScorerToken();
}

const REFRESH_MS = 30_000;

const MESSAGES: Record<Exclude<ScorerLoadFailure, 'offline'>, { title: string; body: string }> = {
  missing: { title: 'No scorer link on this phone', body: 'Open the link or scan the QR code the organiser gave you.' },
  invalid: { title: 'This link isn’t valid', body: 'It may have been copied wrongly. Ask the organiser to send it again.' },
  withdrawn: { title: 'This link has expired or been withdrawn', body: 'Ask the organiser for a new one. Anything already saved on this phone will still try to send.' },
  other: { title: 'Something went wrong', body: 'The timetable couldn’t be loaded. Try again in a moment.' },
};

function heatIsComplete(heat: Heat): boolean {
  return heat.races.length > 0 && heat.races.every((race) => race.isComplete);
}

/** Replaces one heat with the server's newer copy. */
function withHeat(session: ScorerSession, sessionId: number, heat: Heat): ScorerSession {
  return {
    ...session,
    sessions: session.sessions.map((s) => s.id !== sessionId ? s : { ...s, heats: s.heats.map((h) => h.id === heat.id ? heat : h) }),
  };
}

/**
 * Where a volunteer scores one arena from a link, with no account. It sits outside the app shell and reuses the
 * heat scoring screen and the phone's score outbox, so scores queue offline and send when there's signal.
 */
export function ScorerPage() {
  const [token] = useState(captureToken);
  const [session, setSession] = useState<ScorerSession | null>(() => token ? readSavedScorerSession() : null);
  const [failure, setFailure] = useState<ScorerLoadFailure | null>(token ? null : 'missing');
  const [fromSavedCopy, setFromSavedCopy] = useState(false);
  /** When the timetable on screen last came from the server (null when unknown). */
  const [sessionAt, setSessionAt] = useState<string | null>(() => token ? readSavedScorerSessionAt() : null);
  const [loading, setLoading] = useState(!!token);
  const outbox = useScoreOutbox();

  const load = useCallback(() => {
    return scorerApi.get<unknown>('/scorer/session')
      .then(({ data }) => {
        const parsed = parseScorerSession(data);
        if (!parsed) { setFailure('other'); return; }
        writeSavedScorerSession(parsed);
        setSession(parsed);
        setFailure(null);
        setFromSavedCopy(false);
        setSessionAt(new Date().toISOString());
      })
      .catch((error: unknown) => {
        const why = scorerFailure(error);
        setFailure(why);
        setFromSavedCopy(why === 'offline');
        // A withdrawn or unknown link shouldn't keep showing a timetable the holder can no longer score.
        if (why === 'invalid' || why === 'missing' || why === 'withdrawn') {
          setSession(null);
          if (why !== 'withdrawn') clearScorerToken();
        }
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!token) return;
    void load();
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    const timer = setInterval(refresh, REFRESH_MS);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    const onSaved = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId: number; heat: Heat }>).detail;
      if (detail?.heat) setSession((current) => current ? withHeat(current, detail.sessionId, detail.heat) : current);
    };
    window.addEventListener(HEAT_SAVED, onSaved);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener(HEAT_SAVED, onSaved);
    };
  }, [token, load]);

  const raceSessions = useMemo(
    () => (session?.sessions ?? []).filter((s) => (s.kind ?? 0) === 0).slice().sort((a, b) => {
      const ta = a.scheduledStart ? Date.parse(a.scheduledStart) : Number.MAX_SAFE_INTEGER;
      const tb = b.scheduledStart ? Date.parse(b.scheduledStart) : Number.MAX_SAFE_INTEGER;
      return (ta - tb) || (a.orderIndex - b.orderIndex);
    }),
    [session],
  );

  return (
    <main className="skin mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-3 p-3 pb-10 sm:p-5">
      <header className="space-y-1 pt-2">
        <p className="mg-meta">Scorer link</p>
        <h1 className="mg-h1 mg-h1-sm">{session ? `${session.competitionName || 'Competition'} · ${session.arenaName}` : 'Score this arena'}</h1>
        {session && <p className="mg-meta">Scoring as {session.label}</p>}
      </header>

      {loading && !session && <p role="status" className="mg-card p-4">Loading the timetable…</p>}

      {failure === 'offline' && !(fromSavedCopy && session && !shouldNoticeSavedCopy(sessionAt, true, new Date(), LIVE_SAVED_COPY_NOTICE_AFTER_MS)) && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <CloudOff className="h-4 w-4 shrink-0" />
          <p className="flex-1">
            {fromSavedCopy && session
              ? `${lastUpdatedText(sessionAt)}. No signal; scores you enter will send when you’re back online.`
              : 'No signal, and nothing is saved on this phone yet. Try again when you’re back online.'}
          </p>
          <button type="button" className="btn-ghost min-h-11" onClick={() => void load()}><RefreshCw className="h-4 w-4" /> Try again</button>
        </div>
      )}

      {failure && failure !== 'offline' && (
        <div role="alert" className="mg-card space-y-2 p-4">
          <p className="flex items-center gap-2 font-semibold"><Link2Off className="h-5 w-5 shrink-0" /> {MESSAGES[failure].title}</p>
          <p>{MESSAGES[failure].body}</p>
          {failure === 'other' && <button type="button" className="btn-primary min-h-11" onClick={() => void load()}>Try again</button>}
        </div>
      )}

      {session && failure !== 'invalid' && failure !== 'missing' && (
        <>
          <ScoreOutboxPanel competitionId={session.competitionId} />
          {raceSessions.length === 0
            ? <p className="mg-card p-4">Nothing is timetabled for this arena yet. It will appear here once the organiser adds it.</p>
            : <ArenaScoring key={session.competitionId} sessions={raceSessions} outbox={outbox} />}
        </>
      )}
    </main>
  );
}

function ArenaScoring({ sessions, outbox }: { sessions: Session[]; outbox: ReturnType<typeof useScoreOutbox> }) {
  const [chosenSessionId, setChosenSessionId] = useState<number | null>(null);
  const [chosenHeatId, setChosenHeatId] = useState<number | null>(null);
  const [chosenRaceId, setChosenRaceId] = useState<number | null>(null);
  // null until the scorer touches the tiles, so a scored race shows its saved placings for correcting.
  const [pending, setPending] = useState<PendingPlace[] | null>(null);
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Default to the first session with an unfinished heat, so the scorer lands where the action is.
  const session = sessions.find((s) => s.id === chosenSessionId)
    ?? sessions.find((s) => s.heats.some((h) => !heatIsComplete(h))) ?? sessions[0];
  const heats = session.heats.slice().sort((a, b) => a.orderIndex - b.orderIndex);
  const heat = heats.find((h) => h.id === chosenHeatId) ?? heats.find((h) => !heatIsComplete(h)) ?? heats[0] ?? null;
  const races = (heat?.races ?? []).slice().sort((a, b) => a.orderIndex - b.orderIndex);
  const activeRace = races.find((r) => r.id === chosenRaceId) ?? races.find((r) => !r.isComplete) ?? null;
  // A heat with more teams than lanes races only the lanes, so points are out of the lanes, not the teams.
  const sessionBase = sessionPointsBase(session.heats, session.lanesPerHeat);
  const laneRules = lanesOf(session);
  // Saves still waiting on this phone are shown as if sent.
  const viewHeats = heats.map((h) => withQueuedResults(h, outbox, sessionBase));
  const viewHeat = heat ? viewHeats.find((h) => h.id === heat.id) ?? heat : null;
  const viewRaces = (viewHeat?.races ?? []).slice().sort((a, b) => a.orderIndex - b.orderIndex);
  const heatIndex = heat ? heats.findIndex((h) => h.id === heat.id) : -1;
  const nextLanes = viewHeat ? nextRoundLanes({ ...session, heats: viewHeats }, viewHeat, viewHeats[heatIndex + 1] ?? null, qualifiersOf(session)) : null;
  // In a qualifier only the teams that go through to the final are placed; the rest score 1 point each.
  const qualifierCap = heat?.raceRoundStage === 1 ? qualifiersOf(session) : null;

  function choose(change: { session?: number; heat?: number; race?: number }) {
    if (change.session !== undefined) { setChosenSessionId(change.session); setChosenHeatId(null); setChosenRaceId(null); }
    if (change.heat !== undefined) { setChosenHeatId(change.heat); setChosenRaceId(null); }
    if (change.race !== undefined) setChosenRaceId(change.race);
    // Choosing a different race starts that race's placings afresh, or from its saved results when correcting.
    setPending(null);
  }

  // Correcting a scored race starts from what's there.
  const seeded = activeRace?.isComplete ? placesFromResults(activeRace) : [];
  const shown = pending ?? seeded;

  function change(next: PendingPlace[]) {
    if (activeRace) setUndoStack((stack) => pushUndo(stack, { kind: 'draft', raceId: activeRace.id, places: shown }));
    setPending(next);
  }

  function clickTeam(teamId: number) {
    change(tapTeam(shown, teamId, qualifierCap));
  }

  function toggleElim(teamId: number) {
    change(toggleEliminated(shown, teamId));
  }

  function submit(places: PendingPlace[] = shown) {
    if (!activeRace || !heat) return;
    const reason = reasons[activeRace.id]?.trim();
    if ((activeRace.results.length > 0 || outbox.some((item) => item.raceId === activeRace.id)) && !reason) {
      setSaveError('Add a reason for this correction before saving.');
      return;
    }
    const item: QueuedScore = {
      saveId: crypto.randomUUID(),
      reason,
      viaLink: true,
      raceId: activeRace.id,
      competitionId: session.competitionId,
      sessionId: session.id,
      label: `${heat.label ?? `Heat ${heatIndex + 1}`} · ${activeRace.name}`,
      places: [...places, ...restOfQualifier(heat, places), ...sitOutPlaces(heat, races.findIndex((r) => r.id === activeRace.id), laneRules)],
      expected: placingsOf(activeRace.results),
      teamNames: Object.fromEntries(heat.entries.map((e) => [e.teamId, e.teamName])),
      queuedAt: new Date().toISOString(),
      state: 'waiting',
    };
    const queuedBefore = outbox.find((q) => q.raceId === activeRace.id) ?? null;
    if (!updateOutbox((list) => enqueue(list, item))) { setSaveError(OUTBOX_STORAGE_ERROR); return; }
    setSaveError(null);
    setUndoStack((stack) => pushUndo(dropDrafts(stack, activeRace.id), { kind: 'save', raceId: activeRace.id, sent: item, queuedBefore, draft: places }));
    setPending([]);
    const queuedIds = new Set([...outbox.map((q) => q.raceId), activeRace.id]);
    const next = nextRaceToScore(heats, session.raceOrderAlternating === true, { heatId: heat.id, raceId: activeRace.id }, queuedIds);
    if (next) { setChosenHeatId(next.heatId); setChosenRaceId(next.raceId); }
  }

  // Undo takes back the last action on the open race, or else the last save.
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
    const owner = heats.find((h) => h.races.some((r) => r.id === lastUndo.raceId));
    if (owner) { setChosenHeatId(owner.id); setChosenRaceId(lastUndo.raceId); }
    setPending(restore.length > 0 ? restore : null);
  }

  return (
    <div className="space-y-3">
      {saveError && <p role="alert" className="mg-notice">{saveError}</p>}
      {sessions.length > 1 && (
        <label className="flex flex-col gap-1 text-sm font-semibold">Session
          <select className="input min-h-11" value={session.id} onChange={(event) => choose({ session: Number(event.target.value) })}>
            {sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      )}
      {heats.length === 0 && <p className="mg-card p-4">No heats in this session yet.</p>}
      {heats.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Heats">
          {heats.map((h, i) => (
            <button
              key={h.id}
              role="tab"
              aria-selected={h.id === heat?.id}
              onClick={() => choose({ heat: h.id })}
              className={`min-h-11 whitespace-nowrap rounded-md px-3 text-sm font-semibold ${h.id === heat?.id ? 'bg-brand-600 text-white' : heatIsComplete(h) ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-800'}`}
            >
              {h.label ?? `Heat ${i + 1}`}
            </button>
          ))}
        </div>
      )}
      {viewHeat && (
        <ScoringSection
          heat={viewHeat}
          races={viewRaces}
          activeRace={viewRaces.find((r) => r.id === activeRace?.id) ?? null}
          onSelectRace={(id) => { choose({ race: id }); setUndoStack((stack) => dropDrafts(stack)); }}
          sessionBase={sessionBase}
          laneRules={laneRules}
          qualifiers={qualifiersOf(session)}
          pending={shown}
          canScore
          queued={outbox}
          onClickTeam={clickTeam}
          onToggleElim={toggleElim}
          onReset={() => change([])}
          onSubmit={submit}
          onUndo={canUndo ? undo : undefined}
          undoLabel={lastUndo?.kind === 'save' ? 'Undo last save' : 'Undo'}
          allowReasons
          nextLanes={nextLanes}
          correctionReason={activeRace ? reasons[activeRace.id] ?? '' : ''}
          onCorrectionReason={(reason) => { if (activeRace) setReasons((current) => ({ ...current, [activeRace.id]: reason })); }}
        />
      )}
    </div>
  );
}
