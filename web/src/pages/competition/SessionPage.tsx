import { arenaCrewPath } from './crewDutyHelpers';
import { SessionSharePrint } from '../operations/SessionSharePrint';
import { SessionDutyBoard } from './SessionDutyBoard';
import { OutboxTransfer } from '../../components/OutboxTransfer';
import { ArenaHelpSheet } from './ArenaHelpSheet';
import { setHeatEntryBibOverride } from '../../lib/heatBibOverride';
import { useWakeLock } from '../../hooks/useWakeLock';
import { useHideChrome } from '../../components/ScreenChrome';
import { stripInternalSessionNotes } from '../../lib/gateCheck';
import { ConfirmOfficialButton } from '../../components/ProvisionalStatus';
import { useProvisionalState } from '../../hooks/useProvisionalState';
import { getSessionProvisionalState } from '../../lib/provisionalResults';
import { usePageWidth } from '../../components/pageWidthState';
import { NumberField } from '../../components/NumberField';
import { Notice } from '../../components/Notice';
import { Sheet } from '../../components/Sheet';
import { useToast } from '../../components/Toast';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDialogFocus } from '../../components/useDialogFocus';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle, ChevronLeft, ClipboardList, Coffee, Wand2, X, Table2, Trophy,
} from 'lucide-react';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import type { CompetitionDetail, DeclarationForm, Heat, Session, StandingRow } from '../../types';
import type { QueuedScore } from '../../offline/scoreOutbox';
import { SessionEndTransition } from './SessionEndTransition';
import { HeatScores } from './HeatScores';
import { ScoringSection } from './ScoringSection';
import { contactLinks, ringMessage } from '../../lib/contactLinks';
import { ScoreClashBanner, TeamCardBadge, getStoredCards, playAlertChime, setStoredCard, useCardsEnabled, type ScoreClashItem } from './ScoringParts';
import { RaceListPicker, RaceSelect } from '../../components/RacePicker';
import { enqueue, placingsOf } from '../../offline/scoreOutbox';
import { nextRoundLanes } from '../../lib/nextRoundLanes';
import { sessionPointsBase, withQueuedResults } from '../../lib/queuedView';
import { dropDrafts, pushUndo, undoSave, type MarkChange, type UndoEntry } from '../../lib/scoreUndo';
import { allHeats, arenaOf, canScoreHeat, heatBarLabel, heatIsComplete, heatName, heatStatus, type HeatRef } from '../../lib/heatChoices';
import { commentatorFacts } from '../../lib/commentatorFacts';
import type { CardMark } from '../../lib/refereeCards';
import { BetweenHeats, HeatPickerBar, HeatTableView } from './HeatViews';
import {
  clearDeadHeat, markDeadHeat, overridePoints, nextRaceToScore, placesFromResults, readScoringDraft, scoringDraftKey as draftKeyFor, tapTeam, toggleEliminated,
  writeScoringDraft, type PendingPlace,
} from '../../lib/raceScoring';
import { isSaveInFlight, OUTBOX_STORAGE_ERROR, updateOutbox, useScoreOutbox } from '../../offline/useScoreOutbox';
import { laneLabel, LANE_ROTATION_LABELS, LaneRotationMode, type LaneRotationModeValue } from '../../lib/lanes';
import { lanesOf, qualifiersOf, restOfQualifier, sitOutPlaces } from './laneRules';
import { useRaceNotes } from './useRaceNotes';
import { formatPoints } from '../../lib/formatPoints';
import { ScorerLinksCard } from './ScorerLinksCard';
import { QrAccessModal } from '../../components/QrAccessModal';
import { bibAccent } from '../../lib/bib';
import { StreamControlStrip } from '../../components/stream/StreamControlStrip';
import { ordinal } from '../../lib/toplist';
import { statusLetter } from '../../lib/resultStatus';
import { clubLabel } from '../../lib/clubName';

// Official totals include bonuses, HC exclusions and organiser tie decisions.
function useCommentatorStandings(competition: CompetitionDetail, sectionId: number, enabled = true): StandingRow[] {
  const [saved, setSaved] = useState<{ key: string; rows: StandingRow[] } | null>(null);
  const key = `${competition.id}:${sectionId}`;
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    api.get<StandingRow[]>(`/competitions/${competition.id}/standings`, { params: { sectionId } })
      .then(({ data }) => {
        if (!Array.isArray(data) || !data.every((row) => row && Number.isFinite(row.teamId) && Number.isFinite(row.totalPoints) && typeof row.teamName === 'string'))
          throw new Error('Invalid standings');
        if (active) setSaved({ key, rows: data });
      })
      .catch(() => { if (active) setSaved({ key, rows: [] }); });
    return () => { active = false; };
  }, [competition.id, competition.sessions, sectionId, key, enabled]);
  return enabled && saved?.key === key ? saved.rows : [];
}

type CommentatorChoice = 'yes' | 'no' | null;

function readCommentatorChoice(competitionId: number, fromUrl: boolean): CommentatorChoice {
  if (fromUrl) {
    try { localStorage.setItem(`mg.commentatorScoring.${competitionId}`, 'yes'); } catch { /* ignore */ }
    return 'yes';
  }
  try {
    const val = localStorage.getItem(`mg.commentatorScoring.${competitionId}`);
    if (val === 'yes' || val === 'no') return val;
  } catch { /* ignore */ }
  return null;
}

interface PostRaceRecapState {
  raceId: number;
  raceName: string;
  summaryText: string;
  heat: Heat;
  heats: Heat[];
  session: Session;
}

function heatStartTime(session: Session, heat: Heat, heatIndex: number): Date | null {
  if (heat.startedAt) return new Date(heat.startedAt);
  const baseStr = session.scheduledStart;
  if (!baseStr) return null;
  const base = new Date(baseStr);
  const heatMinutes = heat.durationMinutes
    ?? (session.minutesPerHeat ? session.minutesPerHeat : null);
  if (!heatMinutes) return new Date(base.getTime() + heatIndex * 30 * 60_000);
  return new Date(base.getTime() + heatIndex * heatMinutes * 60_000);
}

/** One session on the day. A different session or heat in the address starts afresh, so the page never shows a stale heat. */
export function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  return <SessionScoring key={`${sessionId}:${searchParams.get('heat') ?? ''}`} />;
}

type SessionView = 'score' | 'table' | 'between';

const NO_CARDS: Record<number, CardMark> = {};

function SessionScoring() {
  usePageWidth('wide');
  const navigate = useNavigate();
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
  // Finished sessions show whether their results are still open to queries (15 minutes) or official.
  const provisional = useProvisionalState((now) => (session ? getSessionProvisionalState(session, now) : null));

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
  const heatRefs = useMemo(() => allHeats(competition.sessions), [competition.sessions]);
  // The arena the scorer is working in. Opening a heat in another arena keeps it in the address, so that heat opens as a table.
  const mine = searchParams.get('mine') || (session ? arenaOf(session) : '');
  // A heat in another arena, or one that has not started, opens as a read-only table first.
  const [view, setView] = useState<SessionView>(() => {
    if (searchParams.get('score') === '1') return 'score';
    const first = orderedHeats.find((h) => h.id === requestedHeat)?.id ?? firstIncompleteHeatId;
    const ref = heatRefs.find((r) => r.heat.id === first);
    return ref && !canScoreHeat(heatRefs, mine, ref) ? 'table' : 'score';
  });
  const [cardOverrides, setCardOverrides] = useState<{ at: CompetitionDetail; map: Record<number, CardMark> }>({ at: competition, map: {} });
  const [correctionReasons, setCorrectionReasons] = useState<Record<number, string>>({});
  const outbox = useScoreOutbox();
  const [showTransition, setShowTransition] = useState(false);
  const [showGenerator, setShowGenerator] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [callSheetOpen, setCallSheetOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [commentatorPreference, setCommentatorPreference] = useState(() => ({
    competitionId: competition.id, choice: readCommentatorChoice(competition.id, searchParams.get('commentator') === '1'),
  }));
  const commentatorChoice = commentatorPreference.competitionId === competition.id
    ? commentatorPreference.choice : readCommentatorChoice(competition.id, searchParams.get('commentator') === '1');
  const [postRaceRecap, setPostRaceRecap] = useState<PostRaceRecapState | null>(null);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [decFormsResult, setDecFormsResult] = useState<{ competitionId: number; forms: DeclarationForm[] } | null>(null);
  const decForms = useMemo(() => decFormsResult?.competitionId === competition.id ? decFormsResult.forms : [], [decFormsResult, competition.id]);
  const mayManage = canManage(competition);
  const [callingTeamId, setCallingTeamId] = useState<number | null>(null);
  const ringToast = useToast();
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const commentatorMode = commentatorChoice === 'yes';
  function saveCommentatorChoice(next: 'yes' | 'no') {
    setCommentatorPreference({ competitionId: competition.id, choice: next });
    try { localStorage.setItem(`mg.commentatorScoring.${competition.id}`, next); } catch { /* ignore */ }
  }

  async function handleCallMissingTeam(entry: { teamId: number; teamName: string; laneIndex: number }) {
    if (!activeHeat || !session) return;
    const currentEntry = activeHeat.entries.find((candidate) => candidate.teamId === entry.teamId);
    if (!currentEntry) return;
    const drawnLane = activeHeat.entries.map(({ id, laneIndex }) => ({ id, laneIndex })).sort((a, b) => a.laneIndex - b.laneIndex || a.id - b.id)
      .findIndex((candidate) => candidate.id === currentEntry.id) + 1;
    const raceIndex = Math.max(0, activeHeat.races.map(({ id, orderIndex }) => ({ id, orderIndex })).sort((a, b) => a.orderIndex - b.orderIndex).findIndex((race) => race.id === activeRaceId));
    const lane = laneLabel(drawnLane, raceIndex, activeHeat.entries.length, session.lanesPerHeat, session.laneRotationMode ?? LaneRotationMode.MoveUp);
    if (lane === 'S') return;
    setCallingTeamId(entry.teamId);
    const heatIndex = orderedHeats.findIndex((h) => h.id === activeHeat.id);
    const heatLabel = activeHeat.label ?? `Heat ${heatIndex + 1}`;
    const arena = session.arenaName?.trim() || 'Main Arena';
    const body = `🔔 Ring call (${arena}): ${entry.teamName} (Lane ${lane}) needed at the collecting ring now for ${heatLabel}.`;
    try {
      await api.post(`/competitions/${competition.id}/chat`, { body, type: 1 });
      playAlertChime();
      ringToast.show('Ring call sent');
    } catch {
      setSaveError('Couldn’t send ring call. Check your signal and try again.');
    } finally {
      setCallingTeamId(null);
    }
  }

  useEffect(() => {
    if (!mayManage) return;
    let cancelled = false;
    api.get<DeclarationForm[]>('/declaration-forms', { params: { competitionId: competition.id } })
      .then(({ data }) => Array.isArray(data) ? data.filter((form) => form && typeof form.teamId === 'number' && Array.isArray(form.riders)) : [])
      .catch(() => [])
      .then((forms) => { if (!cancelled) setDecFormsResult({ competitionId: competition.id, forms }); });
    return () => { cancelled = true; };
  }, [competition.id, mayManage]);

  const decFormByTeamId = useMemo(() => {
    const m = new Map<number, DeclarationForm>();
    for (const f of decForms) m.set(f.teamId, f);
    return m;
  }, [decForms]);

  // Fall back to the first unfinished heat when none is chosen yet (adjusted during render, not in an effect).
  if (activeHeatId == null && firstIncompleteHeatId != null) setActiveHeatId(firstIncompleteHeatId);

  const activeHeat = orderedHeats.find((h) => h.id === activeHeatId) ?? null;
  // Keep the screen on while staff are scoring a heat.
  useWakeLock(Boolean(session && activeHeat && view === 'score' && canManage(competition)));
  // The scoring screen has its own back button, and no app header or ticker above it.
  useHideChrome(canManage(competition));

  const orderedRaces = useMemo(
    () => (activeHeat?.races ?? []).slice().sort((a, b) => a.orderIndex - b.orderIndex),
    [activeHeat?.races]
  );

  const preferredRaceRef = useRef<number | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the race selection when the heat's races change
    if (!activeHeat) { setActiveRaceId(null); return; }
    // Keep the last completed race open when the heat finishes so corrections stay accessible.
    const preferred = preferredRaceRef.current;
    preferredRaceRef.current = null;
    // A reload of the competition must not pull the scorer off the race they chose, so keep it while it still exists.
    setActiveRaceId((current) => {
      if (preferred == null && current != null && orderedRaces.some((r) => r.id === current)) return current;
      const nextRace = orderedRaces.find((r) => r.id === preferred) ?? orderedRaces.find((r) => !r.isComplete) ?? orderedRaces[orderedRaces.length - 1] ?? null;
      return nextRace?.id ?? null;
    });
  }, [activeHeat, orderedRaces]);

  // The placings being entered belong to one race, so they are stored with that race's draft key.
  // Switching race swaps them, in the same render, for that race's saved draft (a draft always wins)
  // or else nothing. Until the scorer changes something, a finished race simply shows its saved results.
  const scoringDraftKey = activeHeatId && activeRaceId ? draftKeyFor(activeHeatId, activeRaceId) : null;
  // Saves still waiting on this phone are shown as if sent, so the summary, table and next lanes don't wait for signal.
  const viewHeats = useMemo(() => orderedHeats.map((h) => withQueuedResults(h, outbox, sessionBase)), [orderedHeats, outbox, sessionBase]);
  const viewHeat = viewHeats.find((h) => h.id === activeHeatId) ?? null;
  const viewRaces = useMemo(() => (viewHeat?.races ?? []).slice().sort((a, b) => a.orderIndex - b.orderIndex), [viewHeat]);
  // Re-opening a race whose save is still queued seeds the placings from that queued save, not from blank server results.
  const draftRace = viewRaces.find((r) => r.id === activeRaceId) ?? null;
  const serverDraftRace = orderedRaces.find((r) => r.id === activeRaceId) ?? null;
  // Referee notes aren't in the public results, so staff read them separately when correcting a scored race.
  const savedNotes = useRaceNotes(
    serverDraftRace?.id ?? null, canManage(competition) && serverDraftRace?.isComplete === true,
    serverDraftRace?.results.map((r) => `${r.teamId}:${r.placing}:${r.status ?? 0}`).join(',') ?? '');
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

  // Offer the end-of-session screen whenever the session or its heats change and every heat is done.
  // Adjusted during render against the last values seen, so closing the screen is not undone on re-render.
  const [transitionChecked, setTransitionChecked] = useState<{ session: Session | null; orderedHeats: Heat[] } | null>(null);
  if (transitionChecked?.session !== session || transitionChecked?.orderedHeats !== orderedHeats) {
    setTransitionChecked({ session, orderedHeats });
    if (session && orderedHeats.length > 0 && orderedHeats.every(heatIsComplete) && session.status !== 2) {
      setShowTransition(true);
    }
  }

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

  const activeRef = heatRefs.find((r) => r.heat.id === activeHeatId) ?? null;
  const arena = activeRef ? arenaOf(activeRef.session) : mine;
  const nextRef = activeRef
    ? heatRefs.slice(heatRefs.findIndex((r) => r.heat.id === activeRef.heat.id) + 1).find((r) => arenaOf(r.session) === arena) ?? null
    : null;
  const urlFor = (ref: HeatRef, extra = '') => `/competitions/${competition.id}/session/${ref.session.id}?heat=${ref.heat.id}&mine=${encodeURIComponent(mine)}${extra}`;

  const factsSectionId = session?.competitionSectionId ?? competition.sections[0]?.id ?? -1;
  const factStandings = useCommentatorStandings(competition, factsSectionId, commentatorMode && view === 'score');
  const teamFacts = useMemo(
    () => (commentatorMode && viewHeat ? commentatorFacts(viewHeat.entries.map((e) => e.teamId), viewHeat.races, factStandings) : undefined),
    [commentatorMode, viewHeat, factStandings],
  );
  const cardOverridesNow = cardOverrides.at === competition ? cardOverrides.map : NO_CARDS;
  const tableCards = useMemo(() => {
    const out: Record<number, CardMark> = {};
    for (const e of viewHeat?.entries ?? []) if (e.refereeCard) out[e.teamId] = e.refereeCard;
    return out;
  }, [viewHeat]);

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
          {/* Notes can carry internal tags (pause, shift, gate check-ins, point tables); spectators only see the words. */}
          {stripInternalSessionNotes(session.notes) && (
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{stripInternalSessionNotes(session.notes)}</p>
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

  function clearRaceDraft(raceId: number, heatId: number) {
    const key = draftKeyFor(heatId, raceId);
    setPendingState((current) => current.key === key ? { key, places: [], edited: true } : current);
    setUndoStack((current) => current.filter((entry) => entry.raceId !== raceId));
    setCorrectionReasons((current) => { const next = { ...current }; delete next[raceId]; return next; });
  }

  // Marks a team hors concours, or brings it back. The event reloads so standings and the summary follow at once.
  async function setHc(teamId: number, hc: boolean) {
    try {
      await api.put(`/competitions/${competition.id}/teams/${teamId}`, { isHorsConcours: hc });
      setSaveError(null);
      reload();
    } catch {
      setSaveError('Couldn’t change hors concours. Check your signal and try again.');
      throw new Error('Couldn’t change hors concours. Check your signal and try again.');
    }
  }

  /** Today's HC change, noted so Undo can put the team back. */
  async function setHcRecorded(teamId: number, hc: boolean) {
    const before = hcTeamIds.has(teamId);
    await setHc(teamId, hc);
    if (activeRace) recordMark({ type: 'hc', teamId, before });
  }

  function recordMark(change: MarkChange) {
    if (activeRace) setUndoStack((stack) => pushUndo(stack, { kind: 'mark', raceId: activeRace.id, change }));
  }

  /** Gives a team a card, or takes it off. It shows at once and is kept on the server for everyone. */
  async function setCard(teamId: number, card: CardMark, record: boolean) {
    const entry = activeHeat?.entries.find((e) => e.teamId === teamId);
    const before: CardMark = teamId in cardOverridesNow ? cardOverridesNow[teamId] : entry?.refereeCard ?? null;
    setCardOverrides({ at: competition, map: { ...cardOverridesNow, [teamId]: card } });
    try {
      await api.put(`/competitions/${competition.id}/teams/${teamId}/card`, { card: card ?? 'none' });
      setSaveError(null);
      if (record) recordMark({ type: 'card', teamId, before });
      reload();
    } catch {
      setCardOverrides({ at: competition, map: { ...cardOverridesNow, [teamId]: before } });
      setSaveError('Couldn’t change the card. Check your signal and try again.');
    }
  }

  /** Opens a heat from the picker. Another session is another page; a heat that isn't yours to score yet opens as a table. */
  function pickHeat(ref: HeatRef) {
    setPending([]);
    setUndoStack((stack) => dropDrafts(stack));
    if (ref.session.id !== session!.id) {
      navigate(urlFor(ref));
      return;
    }
    setActiveHeatId(ref.heat.id);
    setView(canScoreHeat(heatRefs, mine, ref) ? 'score' : 'table');
  }

  function startNext(ref: HeatRef) {
    if (ref.session.id !== session!.id) {
      navigate(urlFor(ref, '&score=1'));
      return;
    }
    setActiveHeatId(ref.heat.id);
    setView('score');
  }

  // Results go into this phone's outbox and send when there's signal, so the
  // scorer can move straight on to the next race. `places` carries the reasons when the sheet asked for them.
  /** Queues the race's result; false when it can't be saved yet (the error says why). */
  function submit(places: PendingPlace[] = pending): boolean {
    if (!activeRace || !activeHeat || !session) return false;
    const reason = correctionReasons[activeRace.id]?.trim();
    if ((activeRace.results.length > 0 || outbox.some((item) => item.raceId === activeRace.id)) && !reason) {
      setSaveError('Add a reason for this correction before saving.');
      return false;
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
    const nextOutbox = enqueue(outbox, item);
    const stored = updateOutbox((list) => enqueue(list, item));
    if (!stored) { setSaveError(OUTBOX_STORAGE_ERROR); return false; }
    setSaveError(null);
    setUndoStack((stack) => pushUndo(dropDrafts(stack, activeRace.id), { kind: 'save', raceId: activeRace.id, sent: item, queuedBefore, draft: places }));
    if (scoringDraftKey) writeScoringDraft(scoringDraftKey, []);
    setPending([]);

    if (commentatorMode) {
      const updatedHeats = orderedHeats.map((h) => withQueuedResults(h, nextOutbox, sessionBase));
      const updatedHeat = updatedHeats.find((h) => h.id === activeHeat.id) ?? activeHeat;
      const scoredRace = updatedHeat.races.find((r) => r.id === activeRace.id);
      const summaryParts = (scoredRace?.results ?? [])
        .slice()
        .sort((a, b) => {
          if (a.isSitOut !== b.isSitOut) return a.isSitOut ? 1 : -1;
          if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
          return (a.placing ?? 999) - (b.placing ?? 999) || b.points - a.points;
        })
        .map((res) => {
          if (res.isSitOut) return `Sat out ${res.teamName}`;
          if (res.eliminated) return `${statusLetter(true, res.status) ?? 'E'} ${res.teamName}`;
          return `${res.placing != null ? ordinal(res.placing) : ''} ${res.teamName} (+${formatPoints(res.points)} pts)`.trim();
        });
      setPostRaceRecap({
        raceId: activeRace.id,
        raceName: activeRace.name,
        summaryText: summaryParts.join(', ') || 'Results recorded',
        heat: updatedHeat,
        heats: updatedHeats,
        session: { ...session, heats: updatedHeats },
      });
    }

    const queuedIds = new Set([...outbox.map((q) => q.raceId), activeRace.id]);
    // The last race of the heat: stay on it and show the page for the next heat, with its lanes and dec forms.
    if (nextRef && !session.raceOrderAlternating && activeHeat.races.every((r) => r.isComplete || queuedIds.has(r.id))) {
      setView('between');
      return true;
    }
    const next = nextRaceToScore(orderedHeats, session.raceOrderAlternating === true, { heatId: activeHeat.id, raceId: activeRace.id }, queuedIds);
    if (next) {
      if (next.heatId !== activeHeat.id) {
        // Changing heat resets the race selection (effect above); it should land on this race.
        preferredRaceRef.current = next.raceId;
        setActiveHeatId(next.heatId);
      }
      setActiveRaceId(next.raceId);
    }
    return true;
  }

  // Undo takes back the last action: a placing, a swipe or Clear on the open race, or else the last save.
  const lastUndo = undoStack[undoStack.length - 1];
  const canUndo = lastUndo != null && (lastUndo.kind === 'save' || lastUndo.raceId === activeRace?.id);
  function undo() {
    if (!lastUndo) return;
    setUndoStack((stack) => stack.slice(0, -1));
    if (lastUndo.kind === 'draft') { setPending(lastUndo.places); return; }
    if (lastUndo.kind === 'mark') {
      const { change } = lastUndo;
      if (change.type === 'card') void setCard(change.teamId, change.before, false);
      else void setHc(change.teamId, change.before).catch(() => undefined);
      return;
    }
    let restore: PendingPlace[] = [];
    updateOutbox((list) => {
      const result = undoSave(list, lastUndo, new Date(), isSaveInFlight);
      restore = result.restore;
      return result.outbox;
    });
    const heat = orderedHeats.find((h) => h.races.some((r) => r.id === lastUndo.raceId));
    if (!heat) return;
    preferredRaceRef.current = lastUndo.raceId;
    setActiveHeatId(heat.id);
    setActiveRaceId(lastUndo.raceId);
    setView('score');
    setPendingState({ key: draftKeyFor(heat.id, lastUndo.raceId), places: restore, edited: restore.length > 0 });
    if (restore.length === 0) writeScoringDraft(draftKeyFor(heat.id, lastUndo.raceId), []);
  }

  const sectionQuery = session.competitionSectionId != null ? `?section=${session.competitionSectionId}` : '';
  const activeIndex = orderedHeats.findIndex((h) => h.id === activeHeatId);
  const followingHeat = viewHeats[activeIndex + 1]
    ?? competition.sessions.filter((s) => (s.kind ?? 0) === 0 && s.orderIndex > session.orderIndex).sort((a, b) => a.orderIndex - b.orderIndex).find((s) => s.heats.length > 0)?.heats
      .slice().sort((a, b) => a.orderIndex - b.orderIndex)[0]
    ?? null;
  const nextLanes = viewHeat ? nextRoundLanes({ ...session, heats: viewHeats }, viewHeat, followingHeat, qualifiersOf(session), hcTeamIds) : null;

  const teamNamesById: Record<number, string> = {};
  for (const t of competition.teams) teamNamesById[t.id] = t.displayName;
  for (const h of orderedHeats) {
    for (const e of h.entries) teamNamesById[e.teamId] = e.teamName;
  }

  const clashes: ScoreClashItem[] = outbox
    .filter((q) => q.state === 'conflict' && q.sessionId === session.id)
    .map((q) => {
      const serverRace = orderedHeats.flatMap((h) => h.races).find((r) => r.id === q.raceId);
      return {
        raceId: q.raceId,
        raceName: serverRace?.name ?? q.label,
        raceOrder: serverRace?.orderIndex,
        sessionId: q.sessionId,
        existingPlaces: (serverRace?.results ?? []).map((r) => ({
          teamId: r.teamId,
          place: r.placing ?? 0,
          eliminated: r.eliminated,
          points: r.points,
          status: r.status,
        })),
        incomingPlaces: q.places.map((p) => ({
          teamId: p.teamId,
          place: p.place,
          eliminated: p.eliminated,
          points: p.points,
          status: p.status,
        })),
      };
    });

  function resolveClash(clash: ScoreClashItem, useIncoming: boolean) {
    if (!useIncoming) {
      updateOutbox((list) => list.filter((q) => q.raceId !== clash.raceId));
      return;
    }
    const existingItem = outbox.find((q) => q.raceId === clash.raceId);
    if (!existingItem) return;
    updateOutbox((list) =>
      enqueue(list, {
        ...existingItem,
        saveId: crypto.randomUUID(),
        expected: clash.existingPlaces.map((p) => ({ teamId: p.teamId, place: p.place, eliminated: p.eliminated })),
        reason: 'Score clash resolved',
        state: 'waiting',
      }),
    );
  }

  const assignedTeamIds = new Set(orderedHeats.flatMap((h) => h.entries.map((e) => e.teamId)));
  const unassignedTeams = orderedHeats.length === 0
    ? []
    : competition.teams.filter(
        (t) =>
          !t.isWithdrawn
          && (session.competitionSectionId == null || t.competitionSectionId === session.competitionSectionId)
          && !assignedTeamIds.has(t.id),
      );

  async function addUnassignedTeamToActiveHeat(teamId: number) {
    if (!activeHeat || !session) return;
    const assignments = orderedHeats.map((h, i) => {
      const label = h.label?.trim() || `Heat ${i + 1}`;
      const currentIds = h.entries.slice().sort((a, b) => a.laneIndex - b.laneIndex).map((e) => e.teamId);
      return {
        label,
        teamIds: h.id === activeHeat.id ? [...currentIds, teamId] : currentIds,
      };
    });
    try {
      await api.put(
        `/competitions/${competition.id}/sessions/${session.id}/heat-assignments?preserveCompletedScores=true`,
        { assignments },
      );
      setSaveError(null);
      reload();
    } catch {
      setSaveError('Couldn’t add team to this heat. Check your signal and try again.');
    }
  }

  const lateToRing = canOrganise(competition) && view === 'score' && !!activeHeat
    && activeHeat.entries.length > 0 && !activeHeat.startedAt && !activeHeat.races.some((r) => r.isComplete)
    && (() => {
      const scheduledStart = heatStartTime(session, activeHeat, Math.max(0, orderedHeats.findIndex((h) => h.id === activeHeat.id)));
      return scheduledStart != null && nowMs > scheduledStart.getTime();
    })();

  return (
    <div className="space-y-3 pt-3">
      {saveError && <Notice>{saveError}</Notice>}
      <ScoreClashBanner clashes={clashes} teamNamesById={teamNamesById} onResolve={resolveClash} />
      {/* The Official / Provisional mark is not shown on the heat page; organisers keep the Confirm official button. */}
      {provisional && provisional.status !== 'in-progress' && canOrganise(competition) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2" aria-label="Results status">
          <ConfirmOfficialButton competitionId={competition.id} sessionId={session.id} state={provisional} onDone={reload} />
        </div>
      )}

      {canManage(competition) ? (
        <>
          {activeRef && (
            <div>
              <HeatPickerBar
                back={{ to: `/competitions/${competition.id}/scoring${sectionQuery}`, label: 'Back to scoring' }}
                arena={arena}
                label={heatBarLabel(activeRef)}
                items={[
                  ...heatRefs.map((ref) => ({
                    key: `heat:${ref.heat.id}`,
                    label: `${arenaOf(ref.session)} · ${heatBarLabel(ref)}`,
                    status: heatStatus(ref),
                    selected: view !== 'between' && ref.heat.id === activeHeatId,
                    onSelect: () => pickHeat(ref),
                  })),
                  ...(nextRef ? [{
                    key: 'up-next',
                    label: `Up next: ${heatName(nextRef.heat, nextRef.index)}`,
                    status: 'Lanes, teams and dec forms',
                    selected: view === 'between',
                    onSelect: () => setView('between'),
                  }] : []),
                ]}
              />
            </div>
          )}

          {view === 'table' && activeRef && viewHeat && (
            <HeatTableView
              title={`${arena} · ${heatBarLabel(activeRef)}`}
              status={heatStatus(activeRef)}
              heat={viewHeat}
              races={viewRaces}
              rules={lanesOf(session)}
              hcTeamIds={hcTeamIds}
              cardsByTeam={tableCards}
              canOverride
              arena={arena}
              onScoreIt={() => setView('score')}
            />
          )}

          {view === 'between' && nextRef && (
            <BetweenHeats
              title={`Next: ${heatName(nextRef.heat, nextRef.index)}`}
              meta={`${arenaOf(nextRef.session)} · ${heatBarLabel(nextRef)}`}
              heat={nextRef.heat}
              hatbands={competition.laneHatbands}
              decForms={decFormByTeamId}
              startLabel={`Start scoring ${heatName(nextRef.heat, nextRef.index)}`}
              backLabel={`Back to ${activeHeat ? heatName(activeHeat, Math.max(0, orderedHeats.findIndex((h) => h.id === activeHeat.id))) : 'the heat'}`}
              onStart={() => startNext(nextRef)}
              onBack={() => setView('score')}
              onBibOverride={canOrganise(competition) ? async (teamId, colour) => {
                try {
                  await setHeatEntryBibOverride(competition.id, nextRef.session.id, nextRef.heat.id, teamId, colour);
                  reload();
                } catch {
                  setSaveError('Couldn’t change that bib colour. Check your signal and try again.');
                }
              } : undefined}
            />
          )}

          {view === 'score' && canOrganise(competition) && activeHeat && unassignedTeams.length > 0 && (
            <Notice role={null}>
              <span className="font-semibold">Unassigned teams ({unassignedTeams.length}):</span>{' '}
              <span className="inline-flex flex-wrap items-center gap-1.5">
                {unassignedTeams.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => void addUnassignedTeamToActiveHeat(t.id)}
                    className="kit-strip-act"
                  >
                    + Add {t.displayName} to {activeHeat.label ?? 'this heat'}
                  </button>
                ))}
              </span>
            </Notice>
          )}

          {lateToRing && activeHeat && (
            <Notice role={null} actionLabel="Call teams" onAction={() => setCallSheetOpen(true)}>
              {activeHeat.label ?? 'This heat'} is late to the ring
            </Notice>
          )}
          {callSheetOpen && lateToRing && activeHeat && (
            <Sheet title="Call teams to the ring" onClose={() => setCallSheetOpen(false)}>
              <div className="flex flex-col gap-3 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  {activeHeat.entries
                    .slice()
                    .sort((a, b) => a.laneIndex - b.laneIndex)
                    .map((entry) => (
                      <button
                        key={entry.teamId}
                        type="button"
                        disabled={callingTeamId === entry.teamId}
                        onClick={() => void handleCallMissingTeam(entry)}
                        className="mg-btn mg-btn-secondary !min-h-8 !px-2.5 text-xs font-semibold"
                        title={`Call ${entry.teamName} (Lane ${entry.laneIndex}) to ring`}
                      >
                        {callingTeamId === entry.teamId ? 'Calling…' : `Call ${entry.teamName} (L${entry.laneIndex})`}
                      </button>
                    ))}
                </div>
                {(() => {
                  // Staff-only: the number comes from the private declaration response and is never sent anywhere by us.
                  const heatLabel = activeHeat.label ?? `Heat ${Math.max(0, orderedHeats.findIndex((h) => h.id === activeHeat.id)) + 1}`;
                  const arena = session?.arenaName?.trim() || 'Main Arena';
                  const contacts = activeHeat.entries
                    .slice()
                    .sort((a, b) => a.laneIndex - b.laneIndex)
                    .map((entry) => ({ entry, links: contactLinks(decFormByTeamId.get(entry.teamId)?.trainerPhone, ringMessage(heatLabel, arena, entry.teamName)) }))
                    .filter((c) => c.links);
                  if (contacts.length === 0) return null;
                  return (
                    <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-[rgb(var(--mg-line))] pt-2" aria-label="Phone the trainer">
                      <span className="font-semibold text-[rgb(var(--mg-muted))]">Phone the trainer (opens your phone, nothing is sent):</span>
                      {contacts.map(({ entry, links }) => (
                        <span key={entry.teamId} className="inline-flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold">{entry.teamName}</span>
                          <a href={links!.call!} className="mg-btn mg-btn-secondary !min-h-11 !px-3 text-xs font-semibold" aria-label={`Phone the trainer of ${entry.teamName}`}>Phone</a>
                          {links!.whatsApp && (
                            <a href={links!.whatsApp} target="_blank" rel="noopener noreferrer" className="mg-btn mg-btn-secondary !min-h-11 !px-3 text-xs font-semibold" aria-label={`WhatsApp the trainer of ${entry.teamName}`}>WhatsApp</a>
                          )}
                        </span>
                      ))}
                    </div>
                  );
                })()}
                            </div>
            </Sheet>
          )}

          {view === 'score' && (viewHeat ? (
            <ScoringSection
              competitionId={competition.id}
              key={`${viewHeat.id}:${activeRaceId}`}
              heat={viewHeat}
              races={viewRaces}
              activeRace={viewRaces.find((r) => r.id === activeRaceId) ?? null}
              onSelectRace={(id) => { setActiveRaceId(id); setPending([]); setUndoStack((stack) => dropDrafts(stack)); }}
              sessionBase={sessionBase}
              laneRules={lanesOf(session)}
              qualifiers={qualifiersOf(session)}
              pending={pending}
              canScore
              allowAudit
              queued={outbox}
              onClickTeam={clickTeam}
              onToggleElim={toggleElim}
              onReset={resetPending}
              onSubmit={submit}
              onOverridePoints={(teamId, points, reason) => {
                changePending((current) => {
                  const updated = overridePoints(current, teamId, points, reason);
                  if (reason !== undefined) {
                    return updated.map((p) => (p.teamId === teamId ? { ...p, refereeNote: reason } : p));
                  }
                  return updated;
                });
                if (activeRace && points !== undefined && reason?.trim()) {
                  setCorrectionReasons((cur) => (cur[activeRace.id]?.trim() ? cur : { ...cur, [activeRace.id]: reason.trim() }));
                }
              }}
              onDeadHeat={(teamIds) => changePending((current) => markDeadHeat(current, teamIds))}
              onClearDeadHeat={(teamId) => changePending((current) => clearDeadHeat(current, teamId))}
              onUndo={canUndo ? undo : undefined}
              undoLabel={lastUndo?.kind === 'save' ? 'Undo last save' : 'Undo'}
              allowReasons
              hcTeamIds={hcTeamIds}
              onSetHc={canOrganise(competition) ? setHcRecorded : undefined}
              protestCompetitionId={canOrganise(competition) ? competition.id : undefined}
              cards={cardOverridesNow}
              onSetCard={(teamId, card) => setCard(teamId, card, true)}
              tieRule={competition.sections.find((s) => s.id === session.competitionSectionId)?.tieBreakRule}
              notes={summaryNotes}
              nextLanes={nextLanes}
              laneHatbands={competition.laneHatbands}
              onRefresh={reload}
              correctionReason={activeRace ? correctionReasons[activeRace.id] ?? '' : ''}
              onCorrectionReason={(reason) => { if (activeRace) setCorrectionReasons((current) => ({ ...current, [activeRace.id]: reason })); }}
              teamFacts={teamFacts}
              factsOn={commentatorMode}
              onToggleFacts={() => saveCommentatorChoice(commentatorMode ? 'no' : 'yes')}
              toolLinks={[
                { key: 'qr', label: 'QR access', sub: 'Let another scorer in', onSelect: () => setShowQrModal(true) },
                { key: 'pa', label: 'PA desk', sub: 'Read-outs for the announcer', onSelect: () => navigate(`/competitions/${competition.id}/commentary${sectionQuery}`) },
                { key: 'tv', label: 'TV kiosk', sub: 'Big screen for the arena', onSelect: () => navigate(`/competitions/${competition.id}/tv${sectionQuery}`) },
                { key: 'help', label: 'Call for help', sub: 'Farrier, vet or first aid', onSelect: () => setShowHelp(true) },
                { key: 'crew', label: 'Arena crew sheet', sub: 'Props to bring in, clear and keep', onSelect: () => navigate(arenaCrewPath(competition.id, session.id, activeHeat?.id)) },
                { key: 'prizes', label: 'Prize-giving', sub: 'Give the places on the live stream', onSelect: () => navigate(`/competitions/${competition.id}/prize-giving${sectionQuery}`) },
              ]}
              heatTools={(
                <div className="mt-4 space-y-3 border-t border-[rgb(var(--mg-rule-soft))] pt-3">
                  <OutboxTransfer competitionId={competition.id} competitionName={competition.name} viaLink={false} />
                  <SessionSharePrint competition={competition} session={session} />
                  <div className="flex flex-wrap items-center gap-3">
                    <LaneRotationControl session={session} onChanged={reload} />
                    {orderedHeats.some((h) => h.raceRoundStage) && <QualifiersControl session={session} onChanged={reload} />}
                    <button className="btn-ghost !py-1.5 !px-2.5 text-xs" onClick={() => setShowGenerator(true)}>
                      <Wand2 className="w-3.5 h-3.5" /> Set up heats
                    </button>
                  </div>
                  {viewHeat && (
                    <ScoreAdjustmentsPanel
                      session={session}
                      heat={viewHeat}
                      activeRaceId={activeRaceId}
                      hcTeamIds={hcTeamIds}
                      raceNotes={{ ...savedNotes, ...summaryNotes }}
                      onChanged={reload}
                      onError={setSaveError}
                      onRaceCleared={clearRaceDraft}
                    />
                  )}
                  <div className="mt-4 border-t border-[rgb(var(--mg-rule-soft))] pt-3">
                    <SessionDutyBoard competitionId={competition.id} session={session} />
                  </div>
                  <div className="mt-4 border-t border-[rgb(var(--mg-rule-soft))] pt-3">
                    <ScorerLinksCard competitionId={competition.id} canWrite={canManage(competition)} />
                  </div>
                </div>
              )}
              onAddRace={canOrganise(competition) ? async (raceName) => {
                const programme = viewRaces.map((r) => r.name);
                try {
                  await api.put(`/competitions/${competition.id}/sessions/${session.id}/races`, {
                    raceNames: [...programme, raceName],
                  });
                  reload();
                } catch {
                  setSaveError('Couldn’t add race. Check your signal and try again.');
                }
              } : undefined}
            />
          ) : (
            <div className="card flex flex-wrap items-center justify-between gap-2 p-3 text-sm text-slate-500 dark:text-slate-300">
              No heats in this session yet.
              <button className="btn-ghost !py-1.5 !px-2.5 text-xs" onClick={() => setShowGenerator(true)}>
                <Wand2 className="w-3.5 h-3.5" /> Set up heats
              </button>
            </div>
          ))}

        </>
      ) : (
        <HeatScores session={session} heats={orderedHeats} activeHeatId={activeHeatId} />
      )}

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

      {mayManage && postRaceRecap?.session.competitionId === competition.id && postRaceRecap.session.id === session.id && (
        <PostRaceCommentatorModal
          competition={competition}
          recap={postRaceRecap}
          onClose={() => setPostRaceRecap(null)}
        />
      )}

      {ringToast.node}

      {showHelp && (
        <ArenaHelpSheet competitionId={competition.id} sessionId={session.id} arenaName={mine || arenaOf(session)} onClose={() => setShowHelp(false)} />
      )}

      <QrAccessModal
        open={showQrModal}
        onClose={() => setShowQrModal(false)}
        competitionId={competition.id}
        competitionName={competition.name}
        sectionId={session.competitionSectionId}
        canWrite={canManage(competition)}
      />
    </div>
  );
}

function PostRaceCommentatorModal({
  competition,
  recap,
  onClose,
}: {
  competition: CompetitionDetail;
  recap: PostRaceRecapState;
  onClose: () => void;
}) {
  const sectionId = recap.session.competitionSectionId ?? competition.sections[0]?.id ?? -1;
  const section = competition.sections.find((s) => s.id === sectionId) ?? null;
  const cutoffPlaces = section?.finalistCount ?? 6;

  const standings = useCommentatorStandings(competition, sectionId);

  const toplist = useMemo(() => ({
    rows: standings.map((row, index) => ({ teamId: row.teamId, teamName: row.teamName, points: row.totalPoints, position: index + 1 })),
    started: standings.some((row) => row.racesRun > 0),
  }), [standings]);

  const heatTotals = useMemo(() => {
    const entries = recap.heat.entries.slice().sort((a, b) => a.laneIndex - b.laneIndex);
    return entries
      .map((entry) => {
        const pts = recap.heat.races.reduce(
          (sum, r) => sum + (r.results.find((res) => res.teamId === entry.teamId)?.points ?? 0),
          0,
        );
        return { teamId: entry.teamId, teamName: entry.teamName, laneIndex: entry.laneIndex, points: pts };
      })
      .sort((a, b) => b.points - a.points || a.laneIndex - b.laneIndex);
  }, [recap.heat]);


  return (
    <Sheet title={`${recap.raceName} complete`} description={recap.summaryText} onClose={onClose} className="sc-recap-sheet">
      {({ close }) => (
        <>
          {/* Updated heat table */}
          <section aria-label="Updated heat table" className="space-y-2">
            <h3 className="mg-display m-0 flex items-center gap-1.5 text-sm font-bold uppercase tracking-[0.04em] text-[rgb(var(--mg-heading))]">
              <Table2 className="h-4 w-4" aria-hidden="true" /> Updated heat table · {recap.heat.label || 'Heat'}
            </h3>
            <ul className="m-0 flex flex-wrap gap-2 list-none p-0 text-xs">
              {heatTotals.map((row, idx) => (
                <li
                  key={row.teamId}
                  className="rounded-md border border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-ground))] px-2.5 py-1 font-semibold"
                >
                  {ordinal(idx + 1)} {row.teamName}: {formatPoints(row.points)} pts
                </li>
              ))}
            </ul>
            <HeatScores
              session={recap.session}
              heats={recap.heats}
              activeHeatId={recap.heat.id}
              embedded
            />
          </section>

          {/* Official section toplist */}
          <section aria-label="Updated section toplist" className="space-y-2">
            <p className="m-0 text-xs">Scores waiting for signal aren’t in the official toplist yet.</p>
            <div className="flex items-center justify-between gap-2">
              <h3 className="mg-display m-0 flex items-center gap-1.5 text-sm font-bold uppercase tracking-[0.04em] text-[rgb(var(--mg-heading))]">
                <Trophy className="h-4 w-4" aria-hidden="true" /> Official toplist
              </h3>
              <span className="text-xs font-semibold text-[rgb(var(--mg-muted))]">
                Top {cutoffPlaces} Finals cut-off
              </span>
            </div>

            {toplist.rows.length === 0 ? (
              <Notice tone="info">Official standings are unavailable. Try refreshing when you have signal.</Notice>
            ) : (
              <ol className="m-0 divide-y divide-[rgb(var(--mg-rule-soft))] rounded-lg border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-ground))] list-none p-0">
                {toplist.rows.map((row, idx) => (
                  <li key={row.teamId} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="mg-display w-9 font-bold text-[rgb(var(--mg-heading))]">
                        {ordinal(row.position)}
                      </span>
                      <span className="font-bold text-[rgb(var(--mg-ink))]">{row.teamName}</span>
                      {idx === cutoffPlaces - 1 && (
                        <span className="rounded bg-[rgb(var(--mg-tint))] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[rgb(var(--mg-heading))]">
                          Top {cutoffPlaces} Cut-Off
                        </span>
                      )}
                    </div>
                    <span className="mg-display text-sm font-bold tabular-nums text-[rgb(var(--mg-heading))]">
                      {formatPoints(row.points)} pts
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* 1-tap stream overlay buttons */}
          <StreamControlStrip competitionId={competition.id} sectionId={sectionId} activeHeatId={recap.heat.id} compact />
          <div className="kit-acts">
            <button type="button" className="kit-pill kit-pill-fill" onClick={() => close()}>Close</button>
          </div>
        </>
      )}
    </Sheet>
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
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
        <span>Lanes after each race</span>
        <select
          className="input min-h-10 py-1.5 text-xs"
          value={session.laneRotationMode ?? LaneRotationMode.MoveUp}
          onChange={(e) => void change(Number(e.target.value) as LaneRotationModeValue)}
        >
          {([0, 1, 2] as const).map((mode) => <option key={mode} value={mode}>{LANE_ROTATION_LABELS[mode]}</option>)}
        </select>
      </label>
      {error && <Notice>Couldn’t save how lanes change. Check your signal and try again.</Notice>}
    </div>
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
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
        <span>Through to the final</span>
        <select className="input min-h-10 py-1.5 text-xs" value={qualifiersOf(session)} onChange={(e) => void change(Number(e.target.value))}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((count) => <option key={count} value={count}>{count} from each</option>)}
        </select>
      </label>
      {error && <Notice>Couldn’t save how many go through. Check your signal and try again.</Notice>}
    </div>
  );
}

/** Run-off +0.01 tie-breaker, per-race manual score override, team point adjustment, 1-tap HC, Under Review flag, and mid-session race controls for organisers. */
function ScoreAdjustmentsPanel({
  session, heat, activeRaceId, hcTeamIds, raceNotes, onChanged, onError, onRaceCleared,
}: {
  session: Session;
  heat: Heat;
  activeRaceId: number | null;
  hcTeamIds: Set<number>;
  raceNotes: Record<number, string>;
  onChanged: () => void;
  onError: (msg: string | null) => void;
  onRaceCleared: (raceId: number, heatId: number) => void;
}) {
  const entries = heat.entries.slice().sort((a, b) => a.laneIndex - b.laneIndex);
  const races = heat.races.slice().sort((a, b) => a.orderIndex - b.orderIndex);
  const defaultTeamId = entries[0]?.teamId ?? 0;
  const targetRace = races.find((r) => r.id === activeRaceId) ?? races[races.length - 1] ?? null;

  const [runoffWinnerId, setRunoffWinnerId] = useState<number>(defaultTeamId);
  const [appliedRunoffWinnerId, setAppliedRunoffWinnerId] = useState<number | null>(null);

  const [overrideTeamId, setOverrideTeamId] = useState<number>(defaultTeamId);
  const [overridePoints, setOverridePoints] = useState<string>('0');
  const [overrideReason, setOverrideReason] = useState<string>('');

  const [adjustTeamId, setAdjustTeamId] = useState<number>(defaultTeamId);
  const [adjustDelta, setAdjustDelta] = useState<string>('-1');
  const [adjustReason, setAdjustReason] = useState<string>('');

  const [hcTargetTeamId, setHcTargetTeamId] = useState<number>(defaultTeamId);
  const [cardsEnabled] = useCardsEnabled(session.competitionId);
  const [cardTeamId, setCardTeamId] = useState<number>(defaultTeamId);
  const [cardsTick, setCardsTick] = useState(0);
  const storedCards = useMemo(() => {
    void cardsTick;
    return cardsEnabled ? getStoredCards(session.competitionId) : {};
  }, [session.competitionId, cardsEnabled, cardsTick]);

  const [reviewTeamId, setReviewTeamId] = useState<number>(defaultTeamId);
  const [reviewNote, setReviewNote] = useState<string>('');
  const [localReviewOverrides, setLocalReviewOverrides] = useState<Record<string, boolean>>({});

  const [raceNameDraft, setRaceNameDraft] = useState<string>('');
  const [announceRaceUpdate, setAnnounceRaceUpdate] = useState<boolean>(true);
  const uncompletedRacesText = useMemo(
    () => races.filter((r) => !r.isComplete).map((r) => r.name).join('\n'),
    [races],
  );
  const [remainingRacesDraft, setRemainingRacesDraft] = useState<string | null>(null);

  const underReviewTeamIds = useMemo(() => {
    const flagged = new Set<number>();
    if (!targetRace) return flagged;
    for (const e of entries) {
      const key = `${targetRace.id}:${e.teamId}`;
      if (key in localReviewOverrides) {
        if (localReviewOverrides[key]) flagged.add(e.teamId);
      } else {
        const note = raceNotes[e.teamId] ?? '';
        if (/\[under-review\]/i.test(note)) flagged.add(e.teamId);
      }
    }
    return flagged;
  }, [entries, localReviewOverrides, raceNotes, targetRace]);

  const standings = useMemo(() => {
    return entries
      .map((e) => {
        const rawTotal = races.reduce((sum, r) => sum + (r.results.find((res) => res.teamId === e.teamId)?.points ?? 0), 0);
        const total = rawTotal + (appliedRunoffWinnerId === e.teamId ? 0.01 : 0);
        return { teamId: e.teamId, teamName: e.teamName, rawTotal, total };
      })
      .sort((a, b) => b.total - a.total || a.teamId - b.teamId);
  }, [entries, races, appliedRunoffWinnerId]);

  async function recordRunoffWinner() {
    setAppliedRunoffWinnerId(runoffWinnerId);
    onError(null);
    const winnerTotal = standings.find((s) => s.teamId === runoffWinnerId)?.rawTotal;
    const tiedIds = standings.filter((s) => s.rawTotal === winnerTotal).map((s) => s.teamId);
    if (tiedIds.length >= 2) {
      const orderedIds = [runoffWinnerId, ...tiedIds.filter((id) => id !== runoffWinnerId)];
      try {
        await api.put(`/competitions/${session.competitionId}/finals/tie-order`, { teamIds: orderedIds });
        onChanged();
      } catch {
        // The order on screen is only local until the server has it, and finals seeding reads the server's.
        onError('Couldn’t save the run-off result. Check your signal and try again.');
      }
    }
  }

  async function submitPointDirective(teamId: number, directive: string, reason: string, explicitPoints?: number) {
    if (!targetRace) return;
    const existingByTeam = new Map(targetRace.results.map((r) => [r.teamId, r]));
    const places = entries.map((e, i) => {
      const existing = existingByTeam.get(e.teamId);
      const isTarget = e.teamId === teamId;
      return {
        teamId: e.teamId,
        place: existing ? (existing.eliminated ? 0 : existing.placing ?? i + 1) : i + 1,
        eliminated: existing?.eliminated ?? false,
        ...(existing?.status ? { status: existing.status } : {}),
        ...(isTarget && explicitPoints !== undefined ? { points: explicitPoints } : {}),
        ...(isTarget ? { refereeNote: `${directive} ${reason}`.trim() } : {}),
      };
    });
    try {
      await api.post(`/races/${targetRace.id}/results`, { places, reason });
      onError(null);
      onChanged();
    } catch {
      onError('Couldn’t save score adjustment. Check your signal and try again.');
    }
  }

  async function saveOverride() {
    const pts = Number(overridePoints);
    if (overridePoints.trim() === '' || Number.isNaN(pts) || pts < 0 || !Number.isInteger(pts * 2)) {
      onError('Enter whole or half points, such as 3 or 2.5.');
      return;
    }
    const formatted = formatPoints(pts);
    const reason = overrideReason.trim() || `Points set to ${formatted} pts`;
    await submitPointDirective(overrideTeamId, `[pts:${formatted}]`, reason, pts);
    setOverrideReason('');
  }

  async function applyAdjustment() {
    const delta = Number(adjustDelta);
    if (adjustDelta.trim() === '' || Number.isNaN(delta) || delta === 0) {
      onError('Enter a non-zero point adjustment.');
      return;
    }
    if (!Number.isInteger(delta * 2)) {
      onError('Adjust by whole or half points, such as 1 or -0.5.');
      return;
    }
    const reason = adjustReason.trim();
    if (!reason) {
      onError('Add a reason for this point adjustment.');
      return;
    }
    const formatted = formatPoints(Math.abs(delta));
    const signed = delta > 0 ? `+${formatted}` : `-${formatted}`;
    await submitPointDirective(adjustTeamId, `[adj:${signed}]`, reason);
    setAdjustReason('');
  }

  async function toggleOneTapHc() {
    if (!hcTargetTeamId) return;
    const nextHc = !hcTeamIds.has(hcTargetTeamId);
    try {
      await api.put(`/competitions/${session.competitionId}/teams/${hcTargetTeamId}`, { isHorsConcours: nextHc });
      onError(null);
      onChanged();
    } catch {
      onError('Couldn’t change hors concours. Check your signal and try again.');
    }
  }

  async function toggleUnderReview() {
    if (!targetRace || !reviewTeamId) return;
    const nextReview = !underReviewTeamIds.has(reviewTeamId);
    const key = `${targetRace.id}:${reviewTeamId}`;
    try {
      await api.put(`/sessions/races/${targetRace.id}/results/${reviewTeamId}/under-review`, {
        underReview: nextReview,
        note: reviewNote.trim() || undefined,
      });
      setLocalReviewOverrides((cur) => ({ ...cur, [key]: nextReview }));
      setReviewNote('');
      onError(null);
      onChanged();
    } catch {
      onError('Couldn’t update Under Review status. Check your signal and try again.');
    }
  }

  async function clearRaceForRerun() {
    if (!targetRace) return;
    try {
      await api.delete(`/sessions/races/${targetRace.id}/results`);
      writeScoringDraft(draftKeyFor(heat.id, targetRace.id), []);
      onRaceCleared(targetRace.id, heat.id);
      updateOutbox((list) => list.filter((q) => q.raceId !== targetRace.id));
      onError(null);
      onChanged();
    } catch {
      onError('Couldn’t clear race for re-run. Check your signal and try again.');
    }
  }

  async function changeRaceMidSession() {
    if (!targetRace) return;
    const nextName = raceNameDraft.trim();
    if (!nextName) {
      onError('Enter the replacement race name.');
      return;
    }
    const raceIndex = races.findIndex((r) => r.id === targetRace.id);
    const displayNum = raceIndex >= 0 ? raceIndex + 1 : targetRace.orderIndex;
    try {
      await api.put(`/competitions/${session.competitionId}/sessions/${session.id}/races/${targetRace.id}`, {
        newName: nextName,
        applyToAllHeats: true,
      });
      if (announceRaceUpdate) {
        try {
          await api.post(`/competitions/${session.competitionId}/chat`, {
            body: `Update: Race ${displayNum} in ${session.name} is now ${nextName}`,
            type: 1,
          });
        } catch {
          // Non-fatal if chat announcement fails
        }
      }
      setRaceNameDraft('');
      onError(null);
      onChanged();
    } catch {
      onError('Couldn’t change race. Check your signal and try again.');
    }
  }

  async function cancelRaceMidSession() {
    if (!targetRace) return;
    const cancelledName = targetRace.name;
    try {
      await api.delete(`/competitions/${session.competitionId}/sessions/${session.id}/races/${targetRace.id}`);
      if (announceRaceUpdate) {
        try {
          await api.post(`/competitions/${session.competitionId}/chat`, {
            body: `Update: ${cancelledName} in ${session.name} has been cancelled`,
            type: 1,
          });
        } catch {
          // Non-fatal if chat announcement fails
        }
      }
      onError(null);
      onChanged();
    } catch {
      onError('Couldn’t cancel race. Check your signal and try again.');
    }
  }

  return (
    <div className="mt-3 space-y-3 border-t border-slate-200 dark:border-slate-700 pt-3 text-xs">
      {cardsEnabled && entries.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-subtle))] px-3 py-2">
          <span className="font-semibold">Disciplinary card</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              aria-label="Disciplinary card team"
              className="input !min-h-0 !py-1 text-xs"
              value={cardTeamId}
              onChange={(e) => setCardTeamId(Number(e.target.value))}
            >
              {entries.map((e) => <option key={e.teamId} value={e.teamId}>{e.teamName}</option>)}
            </select>
            {(['none', 'yellow', 'red'] as const).map((opt) => {
              const current = storedCards[cardTeamId] ?? 'none';
              const active = current === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  aria-pressed={active}
                  className={`btn-ghost !py-1 !px-2 text-xs ${active ? 'ring-1 ring-[rgb(var(--mg-heading))] font-bold' : ''}`}
                  onClick={() => {
                    setStoredCard(session.competitionId, cardTeamId, opt === 'none' ? null : opt);
                    setCardsTick((t) => t + 1);
                  }}
                >
                  {opt === 'none' ? 'No card' : opt === 'yellow' ? '🟨 Yellow' : '🟥 Red'}
                </button>
              );
            })}
            {storedCards[cardTeamId] && <TeamCardBadge card={storedCards[cardTeamId]} />}
          </div>
        </div>
      )}

      {entries.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Short-handed team</span>
            <select
              aria-label="Short-handed team"
              className="input !min-h-0 !py-1 text-xs"
              value={hcTargetTeamId}
              onChange={(e) => setHcTargetTeamId(Number(e.target.value))}
            >
              {entries.map((e) => <option key={e.teamId} value={e.teamId}>{e.teamName}</option>)}
            </select>
          </label>
          <button type="button" className="btn-ghost !py-1.5 !px-2.5 text-xs" onClick={() => void toggleOneTapHc()}>
            {hcTeamIds.has(hcTargetTeamId) ? 'Remove team HC' : 'Mark team HC (Hors Concours)'}
          </button>
        </div>
      )}

      {entries.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Run-off winner</span>
            <select
              aria-label="Run-off winner"
              className="input !min-h-0 !py-1 text-xs"
              value={runoffWinnerId}
              onChange={(e) => setRunoffWinnerId(Number(e.target.value))}
            >
              {entries.map((e) => <option key={e.teamId} value={e.teamId}>{e.teamName}</option>)}
            </select>
          </label>
          <button type="button" className="btn-ghost !py-1.5 !px-2.5 text-xs" onClick={() => void recordRunoffWinner()}>
            Record run-off winner
          </button>
          {appliedRunoffWinnerId != null && (
            <ul aria-label="Run-off standings" className="flex flex-wrap gap-2 text-[11px] text-slate-600 dark:text-slate-300">
              {standings.map((s, idx) => (
                <li key={s.teamId} data-testid={`runoff-standing-${idx + 1}`}>
                  {idx + 1}. {s.teamName}: {formatPoints(s.total)} pts
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {targetRace && entries.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Under review team</span>
            <select
              aria-label="Under review team"
              className="input !min-h-0 !py-1 text-xs"
              value={reviewTeamId}
              onChange={(e) => setReviewTeamId(Number(e.target.value))}
            >
              {entries.map((e) => <option key={e.teamId} value={e.teamId}>{e.teamName}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Under review note</span>
            <input
              aria-label="Under review note"
              type="text"
              placeholder="e.g. Steward enquiry"
              className="input !min-h-0 !py-1 text-xs"
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
            />
          </label>
          <button type="button" className="btn-ghost !py-1.5 !px-2.5 text-xs" onClick={() => void toggleUnderReview()}>
            {underReviewTeamIds.has(reviewTeamId) ? 'Remove under review' : 'Flag under review'}
          </button>
          {underReviewTeamIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" aria-label="Under review results">
              {entries.filter((e) => underReviewTeamIds.has(e.teamId)).map((e) => (
                <span
                  key={e.teamId}
                  data-testid={`under-review-badge-${e.teamId}`}
                  className="inline-flex items-center rounded bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900 dark:bg-amber-900/50 dark:text-amber-200"
                >
                  UNDER REVIEW: {e.teamName}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {targetRace && entries.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Team</span>
            <select
              aria-label="Team"
              className="input !min-h-0 !py-1 text-xs"
              value={overrideTeamId}
              onChange={(e) => setOverrideTeamId(Number(e.target.value))}
            >
              {entries.map((e) => <option key={e.teamId} value={e.teamId}>{e.teamName}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Custom points</span>
            <input
              aria-label="Custom points"
              type="number"
              step="0.5"
              className="input !min-h-0 !py-1 text-xs w-20"
              value={overridePoints}
              onChange={(e) => setOverridePoints(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Reason</span>
            <input
              aria-label="Reason"
              type="text"
              placeholder="e.g. Combined heat"
              className="input !min-h-0 !py-1 text-xs"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
            />
          </label>
          <button type="button" className="btn-ghost !py-1.5 !px-2.5 text-xs" onClick={() => void saveOverride()}>
            Set points
          </button>
        </div>
      )}

      {targetRace && entries.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Adjustment team</span>
            <select
              aria-label="Adjustment team"
              className="input !min-h-0 !py-1 text-xs"
              value={adjustTeamId}
              onChange={(e) => setAdjustTeamId(Number(e.target.value))}
            >
              {entries.map((e) => <option key={e.teamId} value={e.teamId}>{e.teamName}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Point adjustment</span>
            <input
              aria-label="Point adjustment"
              type="number"
              step="0.5"
              className="input !min-h-0 !py-1 text-xs w-20"
              value={adjustDelta}
              onChange={(e) => setAdjustDelta(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Adjustment reason</span>
            <input
              aria-label="Adjustment reason"
              type="text"
              placeholder="Required reason"
              className="input !min-h-0 !py-1 text-xs"
              value={adjustReason}
              onChange={(e) => setAdjustReason(e.target.value)}
            />
          </label>
          <button type="button" className="btn-ghost !py-1.5 !px-2.5 text-xs" onClick={() => void applyAdjustment()}>
            Apply adjustment
          </button>
        </div>
      )}

      {targetRace && (
        <div className="flex flex-wrap items-end gap-2 border-t border-slate-200 dark:border-slate-700 pt-2">
          <div className="min-w-[220px] flex-1">
            <RaceSelect
              label={`New race name (${targetRace.name})`}
              ariaLabel="New race name"
              value={raceNameDraft}
              onChange={setRaceNameDraft}
              placeholder={targetRace.name}
            />
          </div>
          <label className="flex items-center gap-1.5 py-1.5">
            <input
              type="checkbox"
              aria-label="Post announcement to competition"
              checked={announceRaceUpdate}
              onChange={(e) => setAnnounceRaceUpdate(e.target.checked)}
            />
            <span>Post announcement to competition</span>
          </label>
          <button type="button" className="btn-ghost !py-1.5 !px-2.5 text-xs" onClick={() => void changeRaceMidSession()}>
            Change race
          </button>
          <button type="button" className="btn-ghost !py-1.5 !px-2.5 text-xs text-rose-700 dark:text-rose-300" onClick={() => void cancelRaceMidSession()}>
            Cancel race
          </button>
          <button type="button" className="btn-ghost !py-1.5 !px-2.5 text-xs" onClick={() => void clearRaceForRerun()}>
            Re-run stopped race
          </button>
        </div>
      )}

      <div className="space-y-1.5 border-t border-slate-200 dark:border-slate-700 pt-2">
        <RaceListPicker
          label="Remaining uncompleted races"
          ariaLabel="Remaining uncompleted races"
          races={(remainingRacesDraft ?? uncompletedRacesText).split('\n').map((s) => s.trim()).filter(Boolean)}
          onChange={(next) => setRemainingRacesDraft(next.join('\n'))}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost !py-1.5 !px-2.5 text-xs"
            onClick={async () => {
              const text = remainingRacesDraft ?? uncompletedRacesText;
              const remaining = text.split('\n').map((s) => s.trim()).filter(Boolean);
              const raceNames = races.flatMap((race) => race.isComplete ? [race.name] : remaining.length ? [remaining.shift()!] : []);
              raceNames.push(...remaining);
              try {
                await api.put(`/competitions/${session.competitionId}/sessions/${session.id}/races`, { raceNames });
                setRemainingRacesDraft(null);
                onError(null);
                onChanged();
              } catch (error) {
                const message = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
                onError(message || 'Couldn’t update session races. Check your signal and try again.');
              }
            }}
          >
            Save race line-up
          </button>
        </div>
      </div>
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
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, onClose, 'button');
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
  const [showAll, setShowAll] = useState(true);
  // Pre-select all active (non-withdrawn) section teams so teams without a declaration form yet are
  // never silently dropped when generating the heat draw.
  const defaultSelection = useMemo(() => {
    if (decFormsLoading) return new Set<number>();
    return new Set(sectionTeams.filter((t) => !t.isWithdrawn).map((t) => t.id));
  }, [decFormsLoading, sectionTeams]);
  const [choice, setChoice] = useState<{ sectionTeams: typeof sectionTeams; decdTeamIds: Set<number>; selected: Set<number> } | null>(null);
  const selected = choice && choice.sectionTeams === sectionTeams && choice.decdTeamIds === decdTeamIds ? choice.selected : defaultSelection;
  function setSelected(next: Set<number> | ((current: Set<number>) => Set<number>)) {
    setChoice({ sectionTeams, decdTeamIds, selected: typeof next === 'function' ? next(selected) : next });
  }

  const groupedByClub = useMemo(() => {
    const visible = sectionTeams.filter((t) => showAll || decdTeamIds.has(t.id));
    const m = new Map<string, typeof sectionTeams>();
    for (const t of visible) {
      const key = clubLabel(t.clubName);
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(t);
    }
    return Array.from(m.entries())
      .map(([club, ts]) => ({ club, teams: ts.slice().sort((a, b) => a.suffix.localeCompare(b.suffix)) }))
      .sort((a, b) => (a.club === '' ? 1 : b.club === '' ? -1 : a.club.localeCompare(b.club)));
  }, [sectionTeams, decdTeamIds, showAll]);

  const defaultRaces = 'Litter Lifter\nFlag\nBottle\nMug\nBall and Cone';
  const [races, setRaces] = useState(() => (
    session.plannedRaces?.length
      ? session.plannedRaces.join('\n')
      : session.heats[0]?.races.map((r) => r.name).join('\n') || defaultRaces
  ));
  const [lanes, setLanes] = useState<number>(session.lanesPerHeat ?? 6);
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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
    setSubmitError(null);
    try {
      await api.post(`/competitions/${competition.id}/sessions/${session.id}/generate-heats`, {
        teamIds: Array.from(selected),
        raceNames,
        lanesPerHeat: lanes,
        replaceExisting: replace,
      });
      onDone();
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setSubmitError(msg || 'Couldn’t generate heats. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  const sizes = balancedHeatSizes(selected.size, Math.max(1, lanes));
  const raceCount = races.split('\n').map((r) => r.trim()).filter(Boolean).length || 0;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm grid place-items-center p-3"
      onClick={onClose}
    >
      <motion.div
        ref={dialogRef} role="dialog" aria-modal="true" aria-label="Set up heats"
        initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }}
        className="card w-full max-w-xl max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 p-3 border-b border-slate-200 dark:border-slate-800">
          <Wand2 className="w-4 h-4 text-brand-600" />
          <h3 className="font-semibold text-sm flex-1">Set up heats</h3>
          <button onClick={onClose} aria-label="Close" className="btn-ghost !py-1 !px-1.5"><X className="w-4 h-4" /></button>
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
                  {g.club && <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold px-1">{g.club}</div>}
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
                            {!hasDec && <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" aria-hidden="true" />}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="block">
            <RaceListPicker
              label="Race names"
              ariaLabel="Race names"
              races={races.split('\n').map((r) => r.trim()).filter(Boolean)}
              onChange={(next) => setRaces(next.join('\n'))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-semibold">Max teams per heat</span>
              <NumberField
                min={1} max={20}
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
                  Creates <span className="font-semibold">{sizes.length}</span> heat{sizes.length === 1 ? '' : 's'} of{' '}
                  <span className="font-semibold">{sizes.join(', ')}</span> teams,
                  each running {raceCount} race{raceCount === 1 ? '' : 's'}.
                </>
            }
          </div>
          {submitError && <Notice>{submitError}</Notice>}
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
