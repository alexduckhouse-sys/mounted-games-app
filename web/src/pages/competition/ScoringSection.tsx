import { useEffect, useMemo, useState } from 'react';
import { useSavedTick } from '../../components/SavedTick';
import { ChevronLeft, ChevronRight, CloudOff, Printer, SlidersHorizontal, Trash2, Undo2 } from 'lucide-react';
import { hatbandFor, inLaneOrder } from '../../lib/laneOrder';
import { describePlacings, type QueuedScore } from '../../offline/scoreOutbox';
import type { NextLanes } from '../../lib/nextRoundLanes';
import { manualPoints, type PendingPlace } from '../../lib/raceScoring';
import { pointsForPlace } from '../../lib/queuedView';
import { summariseRace } from '../../lib/raceSummary';
import { getSortByLaneOrder, PREFS_CHANGED_EVENT } from '../../lib/userPrefs';
import { TieBreakRule, type Heat, type Race } from '../../types';
import { displayLaneFor, sitsOutOf, type LaneRules } from './laneRules';
import {
  EliminationSheet, HeatGrid, NextLanesCard, ScoreOverrideSheet, ScoreRow, SummaryCard,
  getStoredCards, parseRefereeCard, useCardsEnabled, type RefereeCard, type ScoreOverrideValue,
} from './ScoringParts';
import { HeatPrintSheet } from './HeatPrintSheet';
import { ScoreAuditPanel } from '../operations/ScoreAuditPanel';
import './scoring.css';

export type { PendingPlace } from '../../lib/raceScoring';

interface ScoringProps {
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
  /** Teams marked hors concours, and how organisers change that. Without the handler there is no HC button. */
  hcTeamIds?: ReadonlySet<number>;
  onSetHc?: (teamId: number, hc: boolean) => Promise<void> | void;
  /** Optional callback when a scorer overrides a team's points in the active race. */
  onOverridePoints?: (teamId: number, points: number | undefined, reason?: string) => void;
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
  /** Current competition ID for persisting card indicators. */
  competitionId?: number;
  /** Optional mid-session race controls surfaced inside the score override sheet. */
  onAddRace?: (raceName: string) => Promise<void> | void;
  onRenameRace?: (newName: string) => Promise<void> | void;
  onRerunRace?: () => Promise<void> | void;
  runoffTeams?: Array<{ id: number; name: string }>;
  onPickRunoffWinner?: (teamId: number) => Promise<void> | void;
}

const NO_TEAMS: ReadonlySet<number> = new Set();

export function ScoringSection({
  heat, races, activeRace, onSelectRace, sessionBase, laneRules, qualifiers, pending, canScore, queued,
  onClickTeam, onToggleElim, onReset, onSubmit, correctionReason, onCorrectionReason, allowAudit = false,
  onUndo, undoLabel = 'Undo', allowReasons = false, hcTeamIds = NO_TEAMS, onSetHc, onOverridePoints,
  tieRule = TieBreakRule.Countback, notes = {}, nextLanes = null, laneHatbands = null, onRefresh,
  competitionId, onAddRace, onRenameRace, onRerunRace, runoffTeams, onPickRunoffWinner,
}: ScoringProps) {
  const [sheet, setSheet] = useState(false);
  const [overrideSheet, setOverrideSheet] = useState(false);
  const [auditRaceId, setAuditRaceId] = useState<number | null>(null);
  const [cardEventTick, setCardEventTick] = useState(0);
  const [sortByLane, setSortByLane] = useState(() => getSortByLaneOrder());
  const [cardsEnabled] = useCardsEnabled(competitionId);

  useEffect(() => {
    function onUpdate() { setCardEventTick((t) => t + 1); }
    function onPrefs() { setSortByLane(getSortByLaneOrder()); }
    window.addEventListener('mg-cards-updated', onUpdate);
    window.addEventListener(PREFS_CHANGED_EVENT, onPrefs);
    function onStorage() { onUpdate(); onPrefs(); }
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('mg-cards-updated', onUpdate);
      window.removeEventListener(PREFS_CHANGED_EVENT, onPrefs);
    };
  }, []);

  const pendingByTeam = new Map(pending.map((p) => [p.teamId, p]));
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
      if (points !== undefined) overrides[place.teamId] = { points, reason: place.refereeNote?.replace(/\[pts:[^\]]*\]/gi, '').trim() };
    }
    return overrides;
  }, [pending]);

  const storedCards = useMemo(() => {
    void cardEventTick;
    return cardsEnabled ? getStoredCards(competitionId) : {};
  }, [competitionId, cardEventTick, cardsEnabled]);
  const cardsByTeam = useMemo(() => {
    if (!cardsEnabled) return {};
    const cards: Record<number, RefereeCard> = { ...storedCards };
    for (const p of pending) {
      const c = parseRefereeCard(p.refereeNote).card;
      if (c) cards[p.teamId] = c;
    }
    for (const teamIdStr of Object.keys(activeOverrides)) {
      const tid = Number(teamIdStr);
      const c = parseRefereeCard(activeOverrides[tid]?.reason).card;
      if (c) cards[tid] = c;
    }
    for (const teamIdStr of Object.keys(notes)) {
      const tid = Number(teamIdStr);
      const c = parseRefereeCard(notes[tid]).card;
      if (c) cards[tid] = c;
    }
    for (const r of races) {
      for (const res of r.results) {
        const c = parseRefereeCard((res as { refereeNote?: string }).refereeNote).card;
        if (c) cards[res.teamId] = c;
      }
    }
    return cards;
  }, [cardsEnabled, storedCards, pending, activeOverrides, notes, races]);

  // The announcer card sits after the latest finished race that isn't the one open for scoring.
  const summaryIdx = races.reduce((last, r, i) => (r.isComplete && i !== activeIdx ? i : last), -1);
  const summary = summaryIdx >= 0
    ? summariseRace({ heat, races, raceIndex: summaryIdx, hcTeamIds, rule: tieRule, qualifiers, notes })
    : null;

  // A green tick pops up over the page as a race is saved; the page has already moved on to the next race.
  const savedTick = useSavedTick();
  function save(places?: PendingPlace[]) {
    const name = activeRace?.name;
    const saved = places ? onSubmit(places) : onSubmit();
    if (saved !== false && name) savedTick.show(name);
  }

  function complete() {
    if (allowReasons && pending.some((p) => p.eliminated && !p.refereeNote?.trim())) setSheet(true);
    else save();
  }

  function handleReset() { onReset(); }

  function saveOverride(teamId: number, value: ScoreOverrideValue | null) {
    if (activeRace) onOverridePoints?.(teamId, value?.points, value?.reason);
  }

  const rows = useMemo(() => {
    if (!activeRace) return [];
    if (sortByLane) return inLaneOrder(heat, laneIdx, laneRules);
    return [...heat.entries].sort((a, b) => a.laneIndex - b.laneIndex);
  }, [activeRace, sortByLane, heat, laneIdx, laneRules]);

  const racingRows = rows.filter((e) => !sitsOutOf(heat, e, laneIdx, laneRules));
  const lanesByTeam = Object.fromEntries(rows.map((e) => [e.teamId, displayLaneFor(heat, e, laneIdx, laneRules)]));

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
  const activeDone = Boolean(activeRace && (activeRace.isComplete || activeQueued));
  const auditOpen = Boolean(activeRace && auditRaceId === activeRace.id);

  return (
    <section className="space-y-3">
      <div className="sc-main">
        {races.length === 0 && <p className="sc-card sc-pad sc-sub">No races in this heat yet.</p>}
        {activeRace && (
          <section key={activeRace.id} className="sc-card sc-open sc-pad" aria-label={`Scoring ${activeRace.name}`}>
            <div className="sc-race-bar">
              <button
                type="button"
                className="sc-race-nav"
                aria-label="Previous race"
                disabled={activeIdx <= 0}
                onClick={() => { if (activeIdx > 0) onSelectRace(races[activeIdx - 1].id); }}
              >
                <ChevronLeft className="h-6 w-6" aria-hidden="true" />
              </button>
              <div className="sc-race-bar-center">
                <span className={`sc-race-bar-status ${activeDone ? 'sc-race-bar-status-done' : ''}`}>
                  Race {activeIdx + 1} of {races.length} · {activeDone ? 'Scored' : 'Scoring'}
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
                <ChevronRight className="h-6 w-6" aria-hidden="true" />
              </button>
            </div>

            {activeQueued && (
              <p role="status" className="mg-notice mt-2">
                <CloudOff className="mr-1 inline h-4 w-4" aria-hidden="true" />
                Not sent yet: {describePlacings(activeQueued.places, activeQueued.teamNames)}. To change them, score the race again.
              </p>
            )}

            <ul className="sc-rows">
              {rows.map((e) => {
                const lane = displayLaneFor(heat, e, laneIdx, laneRules);
                const sitting = sitsOutOf(heat, e, laneIdx, laneRules);
                const state = pendingByTeam.get(e.teamId);
                const isHc = hcTeamIds.has(e.teamId);
                const ov = activeOverrides[e.teamId];
                const priorTotal = races.reduce(
                  (sum, r) => (r.id === activeRace.id ? sum : sum + (r.results.find((x) => x.teamId === e.teamId)?.points ?? 0)),
                  0,
                );
                const savedResult = activeRace.results.find((result) => result.teamId === e.teamId);
                // Scorer links cannot read private directives. Keep the actual saved score visible
                // while its placing is unchanged, including half-point awards.
                const unchangedScore = state?.refereeNote === undefined && savedResult
                  && savedResult.eliminated === state?.eliminated
                  && (savedResult.placing ?? 0) === (state?.place ?? 0)
                  ? savedResult.points : undefined;
                const racePoints = sitting || isHc
                  ? 0
                  : ov != null
                    ? ov.points
                    : unchangedScore !== undefined
                      ? unchangedScore
                      : state?.eliminated
                      ? 0
                      : state?.place
                        ? pointsFor(state.place, false)
                        : 0;
                return (
                  <ScoreRow
                    key={`${activeRace.id}:${e.id}`}
                    entry={e}
                    lane={lane}
                    hatband={hatbandFor(laneHatbands, lane)}
                    state={state}
                    sitting={sitting}
                    hc={isHc}
                    canScore={canScore}
                    points={racePoints}
                    heatTotal={priorTotal + racePoints}
                    overridePoints={ov?.points}
                    card={cardsByTeam[e.teamId]}
                    onTap={() => onClickTeam(e.teamId)}
                    onSwipeEliminate={() => onToggleElim(e.teamId)}
                    onToggleElim={() => onToggleElim(e.teamId)}
                  />
                );
              })}
            </ul>

            {canScore && (
              <p className="sc-hint">
                Tap in finishing order · Hold or swipe down to eliminate.
                {isQualifier && <> The first {qualifiers} home go through; the rest score 1 point each.</>}
              </p>
            )}

            {canScore && (activeRace.results.length > 0 || activeQueued) && (
              <label className="mt-3 flex flex-col gap-1 text-sm font-semibold">
                Reason for correction
                <textarea className="input min-h-20" maxLength={1000} value={correctionReason} onChange={(event) => onCorrectionReason(event.target.value)} placeholder="What changed, and why?" />
              </label>
            )}

            {canScore && (
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
                  <button
                    type="button"
                    className="sc-tool-btn"
                    aria-label="Score override"
                    onClick={() => setOverrideSheet(true)}
                  >
                    <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="sc-tool-btn"
                    aria-label={undoLabel}
                    disabled={!onUndo}
                    onClick={onUndo}
                  >
                    <Undo2 className="h-5 w-5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="sc-tool-btn"
                    aria-label="Clear"
                    onClick={handleReset}
                  >
                    <Trash2 className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>
                <div className="sc-actions">
                  <button type="button" className="mg-btn mg-btn-primary sc-submit-btn" onClick={complete}>Race complete</button>
                </div>
              </div>
            )}
          </section>
        )}

        {canScore && allowAudit && activeRace?.isComplete && (
          <div className="sc-card sc-pad">
            <button
              type="button"
              className="mg-btn mg-btn-secondary text-xs"
              aria-expanded={auditOpen}
              onClick={() => setAuditRaceId(auditOpen ? null : activeRace.id)}
            >
              Score history &amp; correction
            </button>
            {auditOpen && (
              <div className="mt-3">
                <ScoreAuditPanel raceId={activeRace.id} onChanged={onRefresh} />
              </div>
            )}
          </div>
        )}

        {summary && summaryIdx >= 0 && <SummaryCard summary={summary} raceNumber={summaryIdx + 1} />}
        {nextLanes && <NextLanesCard lanes={nextLanes} />}
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

      {races.length > 0 && <HeatPrintSheet heat={heat} races={races} rules={laneRules} hcTeamIds={hcTeamIds} tieRule={tieRule} hatbands={laneHatbands} />}

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
      {overrideSheet && activeRace && (
        <ScoreOverrideSheet
          key={`${heat.id}:${activeRace.id}`}
          raceName={activeRace.name}
          entries={racingRows}
          lanesByTeam={lanesByTeam}
          pendingByTeam={pendingByTeam}
          pointsFor={pointsFor}
          overrides={activeOverrides}
          hcTeamIds={hcTeamIds}
          onSetHc={canScore ? onSetHc : undefined}
          onSaveOverride={saveOverride}
          onClose={() => setOverrideSheet(false)}
          competitionId={competitionId}
          onAddRace={onAddRace}
          onRenameRace={onRenameRace}
          onRerunRace={onRerunRace}
          runoffTeams={runoffTeams}
          onPickRunoffWinner={onPickRunoffWinner}
        />
      )}
    </section>
  );
}
