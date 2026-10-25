import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CloudOff, Printer, SlidersHorizontal, Trash2, Undo2 } from 'lucide-react';
import { bibName, hatbandFor, inLaneOrder } from '../../lib/laneOrder';
import { describePlacings, placingsOf, type QueuedScore } from '../../offline/scoreOutbox';
import type { NextLanes } from '../../lib/nextRoundLanes';
import { manualPoints, type PendingPlace } from '../../lib/raceScoring';
import { pointsForPlace } from '../../lib/queuedView';
import { summariseRace } from '../../lib/raceSummary';
import { TieBreakRule, type Heat, type Race } from '../../types';
import { displayLaneFor, sitsOutOf, type LaneRules } from './laneRules';
import {
  EliminationSheet, HcConfirm, HeatGrid, LaneView, NextLanesCard, RaceRules, ScoreOverrideSheet, ScoreRow, SummaryCard,
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
  queued: QueuedScore[];
  onClickTeam: (teamId: number) => void;
  onToggleElim: (teamId: number) => void;
  onReset: () => void;
  /** Save the race. The elimination sheet passes the placings with the reasons added; otherwise it is the placings on screen. */
  onSubmit: (places?: PendingPlace[]) => void;
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
}

const NO_TEAMS: ReadonlySet<number> = new Set();

export function ScoringSection({
  heat, races, activeRace, onSelectRace, sessionBase, laneRules, qualifiers, pending, canScore, queued,
  onClickTeam, onToggleElim, onReset, onSubmit, correctionReason, onCorrectionReason,
  onUndo, undoLabel = 'Undo', allowReasons = false, hcTeamIds = NO_TEAMS, onSetHc, onOverridePoints,
  tieRule = TieBreakRule.Countback, notes = {}, nextLanes = null, laneHatbands = null, onRefresh,
  competitionId,
}: ScoringProps) {
  const [sheet, setSheet] = useState(false);
  const [overrideSheet, setOverrideSheet] = useState(false);
  const [hcFor, setHcFor] = useState<{ teamId: number; name: string; isHc: boolean } | null>(null);
  const [hcBusy, setHcBusy] = useState(false);
  const [auditRaceId, setAuditRaceId] = useState<number | null>(null);
  const [cardEventTick, setCardEventTick] = useState(0);
  const [cardsEnabled] = useCardsEnabled(competitionId);

  useEffect(() => {
    function onUpdate() { setCardEventTick((t) => t + 1); }
    window.addEventListener('mg-cards-updated', onUpdate);
    window.addEventListener('storage', onUpdate);
    return () => {
      window.removeEventListener('mg-cards-updated', onUpdate);
      window.removeEventListener('storage', onUpdate);
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

  function complete() {
    if (allowReasons && pending.some((p) => p.eliminated && !p.refereeNote?.trim())) setSheet(true);
    else onSubmit();
  }

  function handleReset() { onReset(); }

  function saveOverride(teamId: number, value: ScoreOverrideValue | null) {
    if (activeRace) onOverridePoints?.(teamId, value?.points, value?.reason);
  }

  async function confirmHc() {
    if (!hcFor || !onSetHc) return;
    setHcBusy(true);
    try { await onSetHc(hcFor.teamId, !hcFor.isHc); } finally { setHcBusy(false); setHcFor(null); }
  }

  const rows = activeRace ? inLaneOrder(heat, laneIdx, laneRules) : [];
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

  return (
    <section className="space-y-3">
      <div className="sc-layout">
        <aside className="sc-lanes">
          {races.length > 0 && <LaneView heat={heat} raceIndex={laneIdx} raceName={races[laneIdx]?.name ?? ''} rules={laneRules} hatbands={laneHatbands} />}
        </aside>

        <div className="sc-main">
          {races.length === 0 && <p className="sc-card sc-pad sc-sub">No races in this heat yet.</p>}
          {races.map((race, i) => {
            const queuedHere = queuedByRace.get(race.id);
            const isActive = race.id === activeRace?.id;
            const done = race.isComplete || Boolean(queuedHere);
            const card = isActive ? (
              <section key={race.id} className="sc-card sc-open sc-pad" aria-label={`Scoring ${race.name}`}>
                <div className="sc-race-bar">
                  <button
                    type="button"
                    className="sc-race-nav"
                    aria-label="Previous race"
                    disabled={i === 0}
                    onClick={() => { if (i > 0) onSelectRace(races[i - 1].id); }}
                  >
                    <ChevronLeft className="h-6 w-6" aria-hidden="true" />
                  </button>
                  <div className="sc-race-bar-center">
                    <span className={`sc-race-bar-status ${done ? 'sc-race-bar-status-done' : ''}`}>
                      Race {i + 1} of {races.length} · {done ? 'Scored' : 'Scoring'}
                    </span>
                    <h3 className="sc-race-bar-name">{race.name}</h3>
                  </div>
                  <button
                    type="button"
                    className="sc-race-nav"
                    aria-label="Next race"
                    disabled={i === races.length - 1}
                    onClick={() => { if (i < races.length - 1) onSelectRace(races[i + 1].id); }}
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
                      (sum, r) => (r.id === race.id ? sum : sum + (r.results.find((x) => x.teamId === e.teamId)?.points ?? 0)),
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
                        key={e.id}
                        entry={e}
                        lane={lane}
                        hatband={hatbandFor(laneHatbands, lane)}
                        state={state}
                        sitting={sitting}
                        hc={isHc}
                        canScore={canScore}
                        canMarkHc={canScore && Boolean(onSetHc)}
                        points={racePoints}
                        heatTotal={priorTotal + racePoints}
                        overridePoints={ov?.points}
                        card={cardsByTeam[e.teamId]}
                        onTap={() => onClickTeam(e.teamId)}
                        onSwipeEliminate={() => onToggleElim(e.teamId)}
                        onToggleElim={() => onToggleElim(e.teamId)}
                        onHc={() => setHcFor({ teamId: e.teamId, name: e.teamName, isHc })}
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

                {canScore && (race.results.length > 0 || activeQueued) && (
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
                      <button type="button" className="mg-btn mg-btn-secondary" disabled={!onUndo} onClick={onUndo}>
                        <Undo2 className="h-4 w-4" aria-hidden="true" /> {undoLabel}
                      </button>
                      <button type="button" className="mg-btn mg-btn-secondary" onClick={handleReset}>
                        <Trash2 className="h-4 w-4" aria-hidden="true" /> Clear
                      </button>
                    </div>
                    <div className="sc-actions">
                      <button type="button" className="mg-btn mg-btn-primary sc-submit-btn" onClick={complete}>Race complete</button>
                    </div>
                  </div>
                )}
              </section>
            ) : done ? (
              <button key={race.id} type="button" className="sc-done" onClick={() => onSelectRace(race.id)}>
                <span className="sc-done-name">{i + 1}. {race.name}</span>
                <span className="sc-done-result">
                  {queuedHere ? describePlacings(queuedHere.places, queuedHere.teamNames)
                    : describePlacings(placingsOf(race.results.filter((r) => !r.isSitOut)), names)}
                </span>
                {queuedHere && <span className="sc-tag"><CloudOff className="mr-1 h-3 w-3" aria-hidden="true" />Not sent</span>}
              </button>
            ) : (
              <section key={race.id} className="sc-next" aria-label={`${race.name}, coming up`}>
                <button type="button" className="sc-done-name" onClick={() => onSelectRace(race.id)}>{i + 1}. {race.name}</button>
                <div className="sc-chips">
                  {inLaneOrder(heat, i, laneRules).map((e) => (
                    <span key={e.id}>Lane {displayLaneFor(heat, e, i, laneRules)}: {e.teamName}<span className="sr-only"> {bibName(e.bibColour)}</span></span>
                  ))}
                </div>
              </section>
            );
            const auditOpen = auditRaceId === race.id;
            return (
              <div key={race.id} className="contents">
                {card}
                {canScore && race.isComplete && (
                  <div className="sc-card sc-pad">
                    <button
                      type="button"
                      className="mg-btn mg-btn-secondary text-xs"
                      aria-expanded={auditOpen}
                      onClick={() => setAuditRaceId(auditOpen ? null : race.id)}
                    >
                      Score history &amp; correction
                    </button>
                    {auditOpen && (
                      <div className="mt-3">
                        <ScoreAuditPanel raceId={race.id} onChanged={onRefresh} />
                      </div>
                    )}
                  </div>
                )}
                {summary && i === summaryIdx && <SummaryCard summary={summary} raceNumber={i + 1} />}
              </div>
            );
          })}
          {nextLanes && <NextLanesCard lanes={nextLanes} />}
        </div>
      </div>

      {races.length > 0 && (
        <div className="flex justify-end">
          <button type="button" className="mg-btn mg-btn-secondary" onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden="true" /> Print heat table</button>
        </div>
      )}
      {races.length > 0 && (
        <HeatGrid heat={heat} races={races} activeRaceId={activeRace?.id ?? null} activeIndex={laneIdx} rules={laneRules}
          pending={pending} pointsFor={pointsFor} hcTeamIds={hcTeamIds} cardsByTeam={cardsByTeam} />
      )}
      <RaceRules races={races} />
      {races.length > 0 && <HeatPrintSheet heat={heat} races={races} rules={laneRules} hcTeamIds={hcTeamIds} tieRule={tieRule} hatbands={laneHatbands} />}

      {sheet && (
        <EliminationSheet
          places={pending}
          names={names}
          onCancel={() => setSheet(false)}
          onSkip={() => { setSheet(false); onSubmit(); }}
          onSave={(places) => { setSheet(false); onSubmit(places); }}
        />
      )}
      {overrideSheet && activeRace && (
        <ScoreOverrideSheet
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
        />
      )}
      {hcFor && <HcConfirm teamName={hcFor.name} isHc={hcFor.isHc} busy={hcBusy} onConfirm={() => void confirmHc()} onCancel={() => setHcFor(null)} />}
    </section>
  );
}
