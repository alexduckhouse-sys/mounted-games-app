import { useDialogFocus } from '../../components/useDialogFocus';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSavedToast } from '../../components/SavedTick';
import { Notice } from '../../components/Notice';
import { ChevronLeft, ChevronRight, CloudOff, Keyboard, MoreHorizontal, Printer, Trash2, Undo2 } from 'lucide-react';
import { useScoringKeys } from '../../hooks/useScoringKeys';
import type { ScoringKeyAction } from '../../lib/scoringKeys';
import { ordinal } from '../../lib/toplist';
import { hatbandFor, inLaneOrder } from '../../lib/laneOrder';
import { describePlacings, type QueuedScore } from '../../offline/scoreOutbox';
import type { NextLanes } from '../../lib/nextRoundLanes';
import { deadHeatPoints, deadHeatSize, isDeadHeat, manualPoints, type PendingPlace } from '../../lib/raceScoring';
import { pointsForPlace } from '../../lib/queuedView';
import { summariseRace } from '../../lib/raceSummary';
import { afterRed, afterYellow, stepPoints, type CardMark } from '../../lib/refereeCards';
import { ELIMINATED_HAPTIC, getSortByLaneOrder, PREFS_CHANGED_EVENT, triggerScorerHaptic } from '../../lib/userPrefs';
import { finishingReview, lastLaneLeft, raceLanes } from '../../lib/raceLanes';
import { TieBreakRule, type Heat, type Race } from '../../types';
import { displayLaneFor, sitsOutOf, type LaneRules } from './laneRules';
import {
  EliminationSheet, HOLD_ELIMINATE_MS, HeatGrid, NextLanesCard, RaceControlsPanel, ScoreRow, SummaryCard, tapHaptic,
  type ScoreOverrideValue,
} from './ScoringParts';
import { RaceToolsSheet, type ToolLink, type ToolTeam } from './RaceToolsSheet';
import { HeatPrintSheet } from './HeatPrintSheet';
import { ScoreAuditPanel } from '../operations/ScoreAuditPanel';
import { ProtestSheet } from '../operations/ProtestSheet';
import './scoring.css';

export type { PendingPlace } from '../../lib/raceScoring';

interface ScoringProps {
  /** The event, for the public live-scores QR on the printed heat sheet. */
  competitionId?: number | null;
  heat: Heat;
  races: Race[];
  activeRace: Race | null;
  onSelectRace: (id: number) => void;
  sessionBase: number;
  laneRules: LaneRules;
  qualifiers: number;
  pending: PendingPlace[];
  canScore: boolean;
  /** History uses signed-in organiser endpoints; scorer links must not enable it. */
  allowAudit?: boolean;
  queued: QueuedScore[];
  onClickTeam: (teamId: number) => void;
  onToggleElim: (teamId: number) => void;
  onReset: () => void;
  /** Save the race. The elimination sheet passes the placings with the reasons added; otherwise it is the placings on screen.
   * Returns false when the save was refused (the page shows why), so the saved tick doesn't play. */
  onSubmit: (places?: PendingPlace[]) => boolean | void;
  correctionReason: string;
  onCorrectionReason: (reason: string) => void;
  /** Take back the last action. Off (undefined) when there is nothing to undo. */
  onUndo?: () => void;
  undoLabel?: string;
  /** Ask why each eliminated team is out when the race is marked complete, including when using a scorer link. */
  allowReasons?: boolean;
  /** Teams marked hors concours, and how organisers change that. Without the handler there is no HC item in race tools. */
  hcTeamIds?: ReadonlySet<number>;
  onSetHc?: (teamId: number, hc: boolean) => Promise<void> | void;
  /** Cards on teams. The card shown for a team is `cards` when it has an entry there, else the one on its lane. Without the handler there are no card items. */
  cards?: Readonly<Record<number, CardMark>>;
  onSetCard?: (teamId: number, card: CardMark) => Promise<void> | void;
  /** Called when a scorer changes a team's points by hand in race tools. */
  onOverridePoints?: (teamId: number, points: number | undefined, reason?: string) => void;
  /** Heat set-up, adjustments and scorer links, shown in the Organiser tools sheet under the race controls. */
  heatTools?: ReactNode;
  /** Mark these teams as a dead heat (same place, shared points). Without it race tools has no Dead heat switch. */
  onDeadHeat?: (teamIds: number[]) => void;
  /** Split a dead heat that the team is part of. */
  onClearDeadHeat?: (teamId: number) => void;
  /** How teams level on points are ordered in the summary. */
  tieRule?: TieBreakRule;
  /** Private reasons already saved for the finished races, by team, for the summary. */
  notes?: Record<number, string>;
  /** The lanes for the next part of the day (the final, or the next heat). */
  nextLanes?: NextLanes | null;
  /** Hatband colour per lane (lane 1 first), when the competition sets them. */
  laneHatbands?: string[] | null;
  /** Reload the competition after a score correction is saved in the audit panel. */
  onRefresh?: () => void;
  /** A short line per team (standing, streak) shown small and blue under the team name. */
  teamFacts?: Readonly<Record<number, string>>;
  /** The commentator facts switch in race tools; without a handler there is no switch. */
  factsOn?: boolean;
  onToggleFacts?: () => void;
  /** Rows after the teams in race tools (QR access, PA desk, TV kiosk...). */
  toolLinks?: ToolLink[];
  /** Mid-session race controls, behind "Organiser tools" in race tools. */
  onAddRace?: (raceName: string) => Promise<void> | void;
  onRenameRace?: (newName: string) => Promise<void> | void;
  onRerunRace?: () => Promise<void> | void;
  runoffTeams?: Array<{ id: number; name: string }>;
  onPickRunoffWinner?: (teamId: number) => Promise<void> | void;
  /** The competition, for staff who can log a protest from race tools. Scorer links leave it out. */
  protestCompetitionId?: number;
}

const NO_TEAMS: ReadonlySet<number> = new Set();
const NO_LINKS: ToolLink[] = [];

/** Runs a change made from race tools. A refusal is already explained by the page, so it is not raised again here. */
/**
 * Stretches the race being scored down to just above the bottom tabs, so the lanes, tools and Save fill one screen.
 * The lanes grow to take the room; with more lanes than fit, the page scrolls as before.
 */
function useFillScreen(active: boolean, raceId: number | undefined) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const fit = () => {
      const tabs = document.querySelector('.mg-tabs');
      const bottom = tabs ? tabs.getBoundingClientRect().top - 10 : window.innerHeight - 12;
      const top = el.getBoundingClientRect().top;
      el.style.minHeight = `${Math.max(0, Math.floor(bottom - top))}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    if (el.parentElement) observer?.observe(el.parentElement.closest('main') ?? el.parentElement);
    return () => { window.removeEventListener('resize', fit); observer?.disconnect(); el.style.minHeight = ''; };
  }, [active, raceId]);
  return ref;
}

async function attempt(action: () => Promise<void> | void): Promise<void> {
  try { await action(); } catch { /* the page says why */ }
}

export function ScoringSection({
  competitionId = null, heat, races, activeRace, onSelectRace, sessionBase, laneRules, qualifiers, pending, canScore, queued,
  onClickTeam, onToggleElim, onReset, onSubmit, correctionReason, onCorrectionReason, allowAudit = false,
  onUndo, undoLabel = 'Undo', allowReasons = false, hcTeamIds = NO_TEAMS, onSetHc, cards, onSetCard, onOverridePoints, onDeadHeat, onClearDeadHeat,
  tieRule = TieBreakRule.Countback, notes = {}, nextLanes = null, laneHatbands = null, onRefresh,
  teamFacts, factsOn, onToggleFacts, toolLinks = NO_LINKS,
  onAddRace, onRenameRace, onRerunRace, runoffTeams, onPickRunoffWinner, heatTools, protestCompetitionId,
}: ScoringProps) {
  const [sheet, setSheet] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  // The read-outs that used to sit under the race now open from race tools, so scoring fits one screen.
  const [infoSheet, setInfoSheet] = useState<'summary' | 'lanes' | 'history' | null>(null);
  const [protesting, setProtesting] = useState(false);
  const [sortByLane, setSortByLane] = useState(() => getSortByLaneOrder());

  useEffect(() => {
    function onPrefs() { setSortByLane(getSortByLaneOrder()); }
    window.addEventListener(PREFS_CHANGED_EVENT, onPrefs);
    window.addEventListener('storage', onPrefs);
    return () => {
      window.removeEventListener('storage', onPrefs);
      window.removeEventListener(PREFS_CHANGED_EVENT, onPrefs);
    };
  }, []);

  // A team the scorer has just asked to put out. Once the page has actually put it out the phone buzzes, once.
  const askedOut = useRef<number | null>(null);
  useEffect(() => {
    const teamId = askedOut.current;
    if (teamId == null) return;
    askedOut.current = null;
    if (pending.some((p) => p.teamId === teamId && p.eliminated)) triggerScorerHaptic(ELIMINATED_HAPTIC);
  }, [pending]);

  const pendingByTeam = new Map(pending.map((p) => [p.teamId, p]));
  function toggleOut(teamId: number) {
    askedOut.current = pendingByTeam.get(teamId)?.eliminated ? null : teamId;
    onToggleElim(teamId);
  }
  const queuedByRace = new Map(queued.map((q) => [q.raceId, q]));
  const activeQueued = activeRace ? queuedByRace.get(activeRace.id) : undefined;
  const activeIdx = activeRace ? races.findIndex((r) => r.id === activeRace.id) : -1;
  const laneIdx = Math.max(activeIdx, 0);
  const names = useMemo(() => Object.fromEntries(heat.entries.map((e) => [e.teamId, e.teamName])), [heat.entries]);
  const isQualifier = heat.raceRoundStage === 1;
  const pointsFor = (place: number, eliminated: boolean) => pointsForPlace(heat, sessionBase, place, eliminated);
  const activeOverrides = useMemo(() => {
    const overrides: Record<number, ScoreOverrideValue> = {};
    for (const place of pending) {
      const points = manualPoints(place.refereeNote, place.points);
      if (points !== undefined) overrides[place.teamId] = { points, reason: place.refereeNote?.replace(/\[pts:[^\]]*\]/gi, '').replace(/\[dead-heat\]/gi, '').trim() };
    }
    return overrides;
  }, [pending]);

  const cardsByTeam = useMemo(() => {
    const out: Record<number, CardMark> = {};
    for (const e of heat.entries) if (e.refereeCard) out[e.teamId] = e.refereeCard;
    for (const [teamId, card] of Object.entries(cards ?? {})) {
      if (card) out[Number(teamId)] = card;
      else delete out[Number(teamId)];
    }
    return out;
  }, [heat.entries, cards]);

  // The announcer card sits after the latest finished race that isn't the one open for scoring.
  const summaryIdx = races.reduce((last, r, i) => (r.isComplete && i !== activeIdx ? i : last), -1);
  const summary = summaryIdx >= 0
    ? summariseRace({ heat, races, raceIndex: summaryIdx, hcTeamIds, rule: tieRule, qualifiers, notes })
    : null;

  // A toast says the race is saved; the page has already moved on to the next race.
  const savedTick = useSavedToast();
  function save(places?: PendingPlace[]) {
    const name = activeRace?.name;
    const saved = places ? onSubmit(places) : onSubmit();
    if (saved !== false) {
      setEditing(false);
      if (name) savedTick.show(name);
    }
  }

  function handleReset() { onReset(); }

  const rows = useMemo(() => {
    if (!activeRace) return [];
    if (sortByLane) return inLaneOrder(heat, laneIdx, laneRules);
    return [...heat.entries].sort((a, b) => a.laneIndex - b.laneIndex);
  }, [activeRace, sortByLane, heat, laneIdx, laneRules]);

  const racingRows = rows.filter((e) => !sitsOutOf(heat, e, laneIdx, laneRules));

  let placedCount = 0;
  let elimCount = 0;
  for (const e of racingRows) {
    const st = pendingByTeam.get(e.teamId);
    const hasOv = activeOverrides[e.teamId] != null;
    if (st?.eliminated && !hasOv) elimCount += 1;
    else if ((st?.place && !st.eliminated) || hasOv) placedCount += 1;
  }
  const doneCount = placedCount + elimCount;
  const allComplete = races.length > 0 && races.every((r) => r.isComplete || queuedByRace.has(r.id));
  const saved = Boolean(activeRace && (activeRace.isComplete || activeQueued));
  // A saved race is read only until the scorer chooses to edit it.
  const live = canScore && (!saved || editing);
  const canSave = racingRows.length > 0 && (doneCount >= racingRows.length || (isQualifier && placedCount >= Math.min(qualifiers, racingRows.length)));
  const fillRef = useFillScreen(Boolean(activeRace) && !allComplete, activeRace?.id);
  const lanes = activeRace ? raceLanes(heat, laneIdx, laneRules, laneHatbands) : [];
  const lastTeamId = live ? lastLaneLeft(lanes, pending, new Set(Object.keys(activeOverrides).map(Number))) : null;
  const review = live && canSave ? finishingReview(lanes, pending, hcTeamIds) : [];

  function complete() {
    if (!canSave) return;
    if (allowReasons && pending.some((p) => p.eliminated && !p.refereeNote?.trim())) setSheet(true);
    else save();
  }

  function pointsOf(teamId: number, sitting: boolean): number {
    const state = pendingByTeam.get(teamId);
    const ov = activeOverrides[teamId];
    if (sitting || hcTeamIds.has(teamId)) return 0;
    if (ov != null) return ov.points;
    const savedResult = activeRace?.results.find((result) => result.teamId === teamId);
    // Scorer links cannot read private directives. Keep the actual saved score visible
    // while its placing is unchanged, including half-point awards.
    if (state?.refereeNote === undefined && savedResult
      && savedResult.eliminated === state?.eliminated
      && (savedResult.placing ?? 0) === (state?.place ?? 0)) return savedResult.points;
    if (state?.eliminated) return 0;
    if (!state?.place) return 0;
    return deadHeatPoints((place) => pointsFor(place, false), state.place, deadHeatSize(pending, teamId));
  }

  const toolTeams: ToolTeam[] = rows.map((e) => {
    const sitting = sitsOutOf(heat, e, laneIdx, laneRules);
    const lane = displayLaneFor(heat, e, laneIdx, laneRules);
    const ov = activeOverrides[e.teamId];
    const place = pendingByTeam.get(e.teamId)?.place;
    const byHand = ov ? ov.points - (place ? pointsFor(place, false) : 0) : undefined;
    return {
      teamId: e.teamId,
      name: e.teamName,
      hatband: hatbandFor(laneHatbands, lane),
      bib: e.bibColour,
      points: pointsOf(e.teamId, sitting),
      byHand,
      card: cardsByTeam[e.teamId] ?? null,
      hc: hcTeamIds.has(e.teamId),
      eliminated: pendingByTeam.get(e.teamId)?.eliminated ?? false,
      sitting,
      deadHeat: isDeadHeat(pendingByTeam.get(e.teamId)),
    };
  });

  const hasControls = Boolean(heatTools || onAddRace || onRenameRace || onRerunRace || (onPickRunoffWinner && runoffTeams && runoffTeams.length > 0));
  const infoLinks: ToolLink[] = [
    ...(summary && summaryIdx >= 0 ? [{ key: 'summary', label: 'Last race', sub: `Placings after ${summary.raceName}`, onSelect: () => setInfoSheet('summary') }] : []),
    ...(nextLanes ? [{ key: 'lanes', label: nextLanes.title, sub: 'Lanes for the next round', onSelect: () => setInfoSheet('lanes') }] : []),
    ...(canScore && allowAudit && activeRace?.isComplete ? [{ key: 'history', label: 'Score history', sub: 'Every save and correction for this race', onSelect: () => setInfoSheet('history') }] : []),
  ];
  const links: ToolLink[] = [
    ...infoLinks.map((l) => ({ ...l, onSelect: () => { setToolsOpen(false); l.onSelect(); } })),
    ...toolLinks.map((l) => ({ ...l, onSelect: () => { setToolsOpen(false); l.onSelect(); } })),
    ...(hasControls ? [{ key: 'organiser', label: 'Organiser tools', sub: 'Races, heats, lanes and adjustments', onSelect: () => { setToolsOpen(false); setControlsOpen(true); } }] : []),
    ...(protestCompetitionId != null ? [{ key: 'protest', label: 'Log a protest', sub: 'Marks the race under review until it’s decided', onSelect: () => { setToolsOpen(false); setProtesting(true); } }] : []),
  ];

  function stepTeam(teamId: number, by: 1 | -1) {
    if (!onOverridePoints) return;
    onOverridePoints(teamId, stepPoints(pointsOf(teamId, false), by));
  }

  // A Bluetooth keypad, page-turner or pedal does what the buttons do (keys in lib/scoringKeys.ts). Nothing scores
  // from the keys while race tools, organiser tools or the elimination sheet is open.
  const [keyed, setKeyed] = useState<{ raceId: number; teamId: number } | null>(null);
  function onKey(action: ScoringKeyAction): boolean {
    switch (action.kind) {
      case 'place':
      case 'eliminate': {
        if (!live || !activeRace) return false;
        const team = racingRows.find((e) => displayLaneFor(heat, e, laneIdx, laneRules) === String(action.lane));
        if (!team) return false;
        tapHaptic();
        if (action.kind === 'place') onClickTeam(team.teamId);
        else onToggleElim(team.teamId);
        setKeyed({ raceId: activeRace.id, teamId: team.teamId });
        return true;
      }
      case 'arm': return live;
      case 'disarm': return true;
      case 'save':
        if (!live || !canSave) return false;
        complete();
        return true;
      case 'undo':
        if (!live || !onUndo) return false;
        onUndo();
        return true;
      case 'advance':
        if (live) {
          if (!canSave) return false;
          complete();
          return true;
        }
        if (activeIdx < 0 || activeIdx >= races.length - 1) return false;
        onSelectRace(races[activeIdx + 1].id);
        return true;
    }
  }
  const keypad = useScoringKeys(canScore && Boolean(activeRace) && !sheet && !toolsOpen && !controlsOpen, onKey);

  // What the last keypad press did, for screen readers: "Bravo, lane 2, 1st".
  let keyedSays = '';
  const keyedEntry = keyed && keyed.raceId === activeRace?.id ? heat.entries.find((e) => e.teamId === keyed.teamId) : undefined;
  if (keyedEntry) {
    const st = pendingByTeam.get(keyedEntry.teamId);
    const outcome = st?.eliminated ? 'out' : st?.place ? ordinal(st.place) : 'no place';
    keyedSays = `${keyedEntry.teamName}, lane ${displayLaneFor(heat, keyedEntry, laneIdx, laneRules)}, ${outcome}`;
  }

  return (
    <section className="space-y-3">
      <div className="sc-main">
        {races.length === 0 && <p className="sc-card sc-pad sc-sub">No races in this heat yet.</p>}
        {activeRace && (
          <section key={activeRace.id} ref={fillRef} className="sc-open sc-fit" aria-label={`Scoring ${activeRace.name}`}>
            <div className="sc-race-bar">
              <button
                type="button"
                className="sc-race-nav"
                aria-label="Previous race"
                disabled={activeIdx <= 0}
                onClick={() => { if (activeIdx > 0) onSelectRace(races[activeIdx - 1].id); }}
              >
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              </button>
              <div className="sc-race-bar-center">
                <span className="sc-race-bar-status">
                  Race {activeIdx + 1} of {races.length} · {editing ? 'Editing' : saved ? 'Scored' : 'Scoring'}
                </span>
                <h3 className="sc-race-bar-name">{activeRace.name}</h3>
              </div>
              <button
                type="button"
                className="sc-race-nav"
                aria-label="Next race"
                disabled={activeIdx >= races.length - 1}
                onClick={() => { if (activeIdx < races.length - 1) onSelectRace(races[activeIdx + 1].id); }}
              >
                <ChevronRight className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            {activeQueued && (
              <Notice tone="info" icon={CloudOff} className="sc-notice">
                Not sent yet: {describePlacings(activeQueued.places, activeQueued.teamNames)}. It sends when there is signal.
              </Notice>
            )}

            <ul className="sc-rows">
              {rows.map((e) => {
                const lane = displayLaneFor(heat, e, laneIdx, laneRules);
                const sitting = sitsOutOf(heat, e, laneIdx, laneRules);
                const ov = activeOverrides[e.teamId];
                return (
                  <ScoreRow
                    key={`${activeRace.id}:${e.id}`}
                    entry={e}
                    lane={lane}
                    hatband={hatbandFor(laneHatbands, lane)}
                    state={pendingByTeam.get(e.teamId)}
                    sitting={sitting}
                    hc={hcTeamIds.has(e.teamId)}
                    canScore={live}
                    points={pointsOf(e.teamId, sitting)}
                    overridePoints={ov?.points}
                    card={cardsByTeam[e.teamId]}
                    fact={teamFacts?.[e.teamId]}
                    last={e.teamId === lastTeamId}
                    onTap={() => onClickTeam(e.teamId)}
                    onSwipeEliminate={() => toggleOut(e.teamId)}
                    onToggleElim={() => toggleOut(e.teamId)}
                  />
                );
              })}
            </ul>

            {keypad && (
              <p className="sc-keypad-chip">
                <Keyboard className="h-3.5 w-3.5" aria-hidden="true" /> Keypad connected
              </p>
            )}
            <p className="sr-only" aria-live="polite">{keyedSays}</p>

            {live && review.length === 0 && <p className="sc-hint sc-hint-quiet">Hold a lane for {HOLD_ELIMINATE_MS / 1000} s to eliminate</p>}
            {live && editing && <p className="sc-hint">Saving again replaces this race’s points.</p>}
            {live && isQualifier && <p className="sc-hint">The first {qualifiers} home go through; the rest score 1 point each.</p>}

            {live && (activeRace.results.length > 0 || activeQueued) && (
              <label className="mt-3 flex flex-col gap-1 text-sm font-semibold">
                Reason for correction
                <textarea className="input min-h-20" maxLength={1000} value={correctionReason} onChange={(event) => onCorrectionReason(event.target.value)} placeholder="What changed, and why?" />
              </label>
            )}

            {canScore && saved && !editing && (
              <div className="sc-bottom sc-bottom-saved">
                <button type="button" className="mg-btn mg-btn-secondary sc-wide-btn" onClick={() => setEditing(true)}>Edit this race</button>
                <button type="button" className="sc-tool-btn" aria-label="Race tools" onClick={() => setToolsOpen(true)}>
                  <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
            )}

            {review.length > 0 && (
              <section className="sc-review" aria-label="Finishing order">
                <h4 className="sc-review-title">Check the order</h4>
                <ol>{review.map((line) => <li key={line.teamId} className={line.out ? 'is-out' : undefined} title={line.text}>{line.short}</li>)}</ol>
              </section>
            )}

            {live && (
              <div className="sc-bottom">
                <div className="sc-toolbar">
                  <div className="sc-progress">
                    <span className="sc-prog-count">
                      {doneCount} <span className="sc-prog-total">of {racingRows.length}</span>
                    </span>
                    {racingRows.length > 0 && (
                      <div className="sc-seg-bar" aria-hidden="true">
                        {racingRows.map((e, segIdx) => (
                          <span
                            key={e.id}
                            className={`sc-seg ${segIdx < placedCount ? 'sc-seg-placed' : segIdx < doneCount ? 'sc-seg-elim' : ''}`}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  <button type="button" className="sc-tool-btn" aria-label="Race tools" onClick={() => setToolsOpen(true)}>
                    <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
                  </button>
                  <button type="button" className="sc-tool-btn" aria-label={undoLabel} disabled={!onUndo} onClick={onUndo}>
                    <Undo2 className="h-5 w-5" aria-hidden="true" />
                  </button>
                  <button type="button" className="sc-tool-btn" aria-label="Clear" onClick={handleReset}>
                    <Trash2 className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>
                <button type="button" className="mg-btn mg-btn-primary sc-submit-btn" disabled={!canSave} onClick={complete}>SAVE SCORES</button>
              </div>
            )}
          </section>
        )}

      </div>

      {allComplete && races.length > 0 && (
        <>
          <div className="flex justify-end">
            <button type="button" className="mg-btn mg-btn-secondary" onClick={() => window.print()}>
              <Printer className="h-4 w-4" aria-hidden="true" /> Print heat table
            </button>
          </div>
          <HeatGrid
            heat={heat}
            races={races}
            activeRaceId={activeRace?.id ?? null}
            activeIndex={laneIdx}
            rules={laneRules}
            pending={pending}
            pointsFor={pointsFor}
            hcTeamIds={hcTeamIds}
            cardsByTeam={cardsByTeam}
          />
        </>
      )}

      {races.length > 0 && <HeatPrintSheet heat={heat} races={races} rules={laneRules} hcTeamIds={hcTeamIds} tieRule={tieRule} hatbands={laneHatbands} competitionId={competitionId} />}

      {sheet && (
        <EliminationSheet
          places={pending}
          names={names}
          onCancel={() => setSheet(false)}
          onSkip={() => { setSheet(false); save(); }}
          onSave={(places) => { setSheet(false); save(places); }}
        />
      )}
      {savedTick.node}
      {toolsOpen && activeRace && (
        <RaceToolsSheet
          teams={toolTeams}
          canHc={Boolean(onSetHc)}
          canCards={Boolean(onSetCard)}
          canChangePoints={live && Boolean(onOverridePoints)}
          onHc={(teamId) => { void attempt(() => onSetHc?.(teamId, !hcTeamIds.has(teamId))); }}
          onYellow={(teamId) => { void attempt(() => onSetCard?.(teamId, afterYellow(cardsByTeam[teamId] ?? null))); }}
          onRed={(teamId) => { void attempt(() => onSetCard?.(teamId, afterRed(cardsByTeam[teamId] ?? null))); }}
          onStepPoints={stepTeam}
          onEliminate={live ? toggleOut : undefined}
          onDeadHeat={live ? onDeadHeat : undefined}
          onClearDeadHeat={live ? onClearDeadHeat : undefined}
          factsOn={factsOn}
          onToggleFacts={onToggleFacts}
          links={links}
          onClose={() => setToolsOpen(false)}
        />
      )}
      {infoSheet && (
        <RtDialog
          scrimLabel="Close"
          label={infoSheet === 'summary' ? 'Last race' : infoSheet === 'lanes' ? 'Next round lanes' : 'Score history'}
          title={infoSheet === 'summary' ? 'Last race' : infoSheet === 'lanes' ? (nextLanes?.title ?? 'Next round') : 'Score history'}
          onClose={() => setInfoSheet(null)}
        >
          {infoSheet === 'summary' && summary && <SummaryCard summary={summary} raceNumber={summaryIdx + 1} />}
          {infoSheet === 'lanes' && nextLanes && <NextLanesCard lanes={nextLanes} />}
          {infoSheet === 'history' && activeRace && <ScoreAuditPanel raceId={activeRace.id} onChanged={onRefresh} heat={protestCompetitionId != null ? heat : undefined} race={activeRace} />}
        </RtDialog>
      )}
      {protesting && protestCompetitionId != null && (
        <ProtestSheet competitionId={protestCompetitionId} heat={heat} race={activeRace} onClose={() => setProtesting(false)} />
      )}
      {controlsOpen && activeRace && (
        <RtDialog scrimLabel="Close organiser tools" label="Organiser tools" title="Organiser tools" onClose={() => setControlsOpen(false)}>
          <RaceControlsPanel
            raceName={activeRace.name}
            onAddRace={onAddRace}
            onRenameRace={onRenameRace}
            onRerunRace={onRerunRace}
            runoffTeams={runoffTeams}
            onPickRunoffWinner={onPickRunoffWinner}
          />
          {heatTools}
        </RtDialog>
      )}
    </section>
  );
}

/** Bottom sheet over the scoring screen: takes focus, closes on Escape and gives focus back. */
function RtDialog({ label, title, scrimLabel, onClose, children }: { label: string; title: string; scrimLabel: string; onClose: () => void; children: ReactNode }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, onClose, '.sc-link');
  return (
    <div className="rt-overlay">
      <button type="button" className="rt-scrim" aria-label={scrimLabel} onClick={onClose} />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={label} className="rt-sheet">
        <div className="rt-head">
          <span className="rt-title">{title}</span>
          <button type="button" className="sc-link" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}
