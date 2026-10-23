import { useMemo, useState } from 'react';
import { CloudOff, Flag, Trash2, Undo2 } from 'lucide-react';
import { bibName, hatbandFor, inLaneOrder } from '../../lib/laneOrder';
import { describePlacings, placingsOf, type QueuedScore } from '../../offline/scoreOutbox';
import type { NextLanes } from '../../lib/nextRoundLanes';
import type { PendingPlace } from '../../lib/raceScoring';
import { pointsForPlace } from '../../lib/queuedView';
import { summariseRace } from '../../lib/raceSummary';
import { TieBreakRule, type Heat, type Race } from '../../types';
import { displayLaneFor, sitsOutOf, type LaneRules } from './laneRules';
import { EliminationSheet, HcConfirm, HeatGrid, LaneView, NextLanesCard, RaceRules, ScoreRow, SummaryCard } from './ScoringParts';
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
  /** Ask why each eliminated team is out when the race is marked complete. Off for scorer links, which can't write referee notes. */
  allowReasons?: boolean;
  /** Teams marked hors concours, and how organisers change that. Without the handler there is no HC button. */
  hcTeamIds?: ReadonlySet<number>;
  onSetHc?: (teamId: number, hc: boolean) => Promise<void> | void;
  /** How teams level on points are ordered in the summary. */
  tieRule?: TieBreakRule;
  /** Private reasons already saved for the finished races, by team, for the summary. */
  notes?: Record<number, string>;
  /** The lanes for the next part of the day (the final, or the next heat). */
  nextLanes?: NextLanes | null;
  /** Hatband colour per lane (lane 1 first), when the competition sets them. */
  laneHatbands?: string[] | null;
}

const NO_TEAMS: ReadonlySet<number> = new Set();

export function ScoringSection({
  heat, races, activeRace, onSelectRace, sessionBase, laneRules, qualifiers, pending, canScore, queued,
  onClickTeam, onToggleElim, onReset, onSubmit, correctionReason, onCorrectionReason,
  onUndo, undoLabel = 'Undo', allowReasons = false, hcTeamIds = NO_TEAMS, onSetHc, tieRule = TieBreakRule.Countback, notes = {}, nextLanes = null, laneHatbands = null,
}: ScoringProps) {
  const [sheet, setSheet] = useState(false);
  const [hcFor, setHcFor] = useState<{ teamId: number; name: string; isHc: boolean } | null>(null);
  const [hcBusy, setHcBusy] = useState(false);
  const pendingByTeam = new Map(pending.map((p) => [p.teamId, p]));
  const queuedByRace = new Map(queued.map((q) => [q.raceId, q]));
  const activeQueued = activeRace ? queuedByRace.get(activeRace.id) : undefined;
  const activeIdx = activeRace ? races.findIndex((r) => r.id === activeRace.id) : -1;
  const laneIdx = Math.max(activeIdx, 0);
  const names = useMemo(() => Object.fromEntries(heat.entries.map((e) => [e.teamId, e.teamName])), [heat.entries]);
  const isQualifier = heat.raceRoundStage === 1;
  const pointsFor = (place: number, eliminated: boolean) => pointsForPlace(heat, sessionBase, place, eliminated);

  // The announcer card sits after the latest finished race that isn't the one open for scoring.
  const summaryIdx = races.reduce((last, r, i) => (r.isComplete && i !== activeIdx ? i : last), -1);
  const summary = summaryIdx >= 0
    ? summariseRace({ heat, races, raceIndex: summaryIdx, hcTeamIds, rule: tieRule, qualifiers, notes })
    : null;

  function complete() {
    if (allowReasons && pending.some((p) => p.eliminated && !p.refereeNote?.trim())) setSheet(true);
    else onSubmit();
  }

  async function confirmHc() {
    if (!hcFor || !onSetHc) return;
    setHcBusy(true);
    try { await onSetHc(hcFor.teamId, !hcFor.isHc); } finally { setHcBusy(false); setHcFor(null); }
  }

  const rows = activeRace ? inLaneOrder(heat, laneIdx, laneRules) : [];

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
                <h3 className="sc-title flex items-center gap-1.5"><Flag className="h-4 w-4 shrink-0" aria-hidden="true" /> {i + 1}. {race.name}</h3>
                {activeQueued && (
                  <p role="status" className="mg-notice mt-2">
                    <CloudOff className="mr-1 inline h-4 w-4" aria-hidden="true" />
                    Not sent yet: {describePlacings(activeQueued.places, activeQueued.teamNames)}. To change them, score the race again.
                  </p>
                )}
                <ul className="sc-rows mt-2">
                  {rows.map((e) => (
                    <ScoreRow
                      key={e.id}
                      entry={e}
                      lane={displayLaneFor(heat, e, laneIdx, laneRules)}
                      hatband={hatbandFor(laneHatbands, displayLaneFor(heat, e, laneIdx, laneRules))}
                      state={pendingByTeam.get(e.teamId)}
                      sitting={sitsOutOf(heat, e, laneIdx, laneRules)}
                      hc={hcTeamIds.has(e.teamId)}
                      canScore={canScore}
                      canMarkHc={canScore && Boolean(onSetHc)}
                      onTap={() => onClickTeam(e.teamId)}
                      onSwipeEliminate={() => onToggleElim(e.teamId)}
                      onToggleElim={() => onToggleElim(e.teamId)}
                      onHc={() => setHcFor({ teamId: e.teamId, name: e.teamName, isHc: hcTeamIds.has(e.teamId) })}
                    />
                  ))}
                </ul>
                {canScore && (
                  <p className="sc-hint">
                    Swipe a team down to eliminate it.
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
                  <div className="sc-actions">
                    <button type="button" className="mg-btn mg-btn-primary" onClick={complete}>Race complete</button>
                    <button type="button" className="mg-btn mg-btn-secondary" disabled={!onUndo} onClick={onUndo}><Undo2 className="h-4 w-4" aria-hidden="true" /> {undoLabel}</button>
                    <button type="button" className="mg-btn mg-btn-secondary" onClick={onReset}><Trash2 className="h-4 w-4" aria-hidden="true" /> Clear</button>
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
            return (
              <div key={race.id} className="contents">
                {card}
                {summary && i === summaryIdx && <SummaryCard summary={summary} raceNumber={i + 1} />}
              </div>
            );
          })}
          {nextLanes && <NextLanesCard lanes={nextLanes} />}
        </div>
      </div>

      {races.length > 0 && (
        <HeatGrid heat={heat} races={races} activeRaceId={activeRace?.id ?? null} activeIndex={laneIdx} rules={laneRules}
          pending={pending} pointsFor={pointsFor} hcTeamIds={hcTeamIds} />
      )}
      <RaceRules races={races} />

      {sheet && (
        <EliminationSheet
          places={pending}
          names={names}
          onCancel={() => setSheet(false)}
          onSkip={() => { setSheet(false); onSubmit(); }}
          onSave={(places) => { setSheet(false); onSubmit(places); }}
        />
      )}
      {hcFor && <HcConfirm teamName={hcFor.name} isHc={hcFor.isHc} busy={hcBusy} onConfirm={() => void confirmHc()} onCancel={() => setHcFor(null)} />}
    </section>
  );
}

