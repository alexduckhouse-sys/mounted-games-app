import { useEffect, useMemo, useState } from 'react';
import { useSavedToast } from '../../components/SavedTick';
import { Notice } from '../../components/Notice';
import { ChevronLeft, ChevronRight, CloudOff, MoreHorizontal, Printer, Trash2, Undo2 } from 'lucide-react';
import { hatbandFor, inLaneOrder } from '../../lib/laneOrder';
import { describePlacings, type QueuedScore } from '../../offline/scoreOutbox';
import type { NextLanes } from '../../lib/nextRoundLanes';
import { manualPoints, type PendingPlace } from '../../lib/raceScoring';
import { pointsForPlace } from '../../lib/queuedView';
import { summariseRace } from '../../lib/raceSummary';
import { afterRed, afterYellow, stepPoints, type CardMark } from '../../lib/refereeCards';
import { getSortByLaneOrder, PREFS_CHANGED_EVENT } from '../../lib/userPrefs';
import { TieBreakRule, type Heat, type Race } from '../../types';
import { displayLaneFor, sitsOutOf, type LaneRules } from './laneRules';
import {
  EliminationSheet, HeatGrid, NextLanesCard, RaceControlsPanel, ScoreRow, SummaryCard,
  type ScoreOverrideValue,
} from './ScoringParts';
import { RaceToolsSheet, type ToolLink, type ToolTeam } from './RaceToolsSheet';
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
  /** Teams marked hors concours, and how organisers change that. Without the handler there is no HC item in race tools. */
  hcTeamIds?: ReadonlySet<number>;
  onSetHc?: (teamId: number, hc: boolean) => Promise<void> | void;
  /** Cards on teams. The card shown for a team is `cards` when it has an entry there, else the one on its lane. Without the handler there are no card items. */
  cards?: Readonly<Record<number, CardMark>>;
  onSetCard?: (teamId: number, card: CardMark) => Promise<void> | void;
  /** Called when a scorer changes a team's points by hand in race tools. */
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
}

const NO_TEAMS: ReadonlySet<number> = new Set();
const NO_LINKS: ToolLink[] = [];

/** Runs a change made from race tools. A refusal is already explained by the page, so it is not raised again here. */
async function attempt(action: () => Promise<void> | void): Promise<void> {
  try { await action(); } catch { /* the page says why */ }
}

export function ScoringSection({
  heat, races, activeRace, onSelectRace, sessionBase, laneRules, qualifiers, pending, canScore, queued,
  onClickTeam, onToggleElim, onReset, onSubmit, correctionReason, onCorrectionReason, allowAudit = false,
  onUndo, undoLabel = 'Undo', allowReasons = false, hcTeamIds = NO_TEAMS, onSetHc, cards, onSetCard, onOverridePoints,
  tieRule = TieBreakRule.Countback, notes = {}, nextLanes = null, laneHatbands = null, onRefresh,
  teamFacts, factsOn, onToggleFacts, toolLinks = NO_LINKS,
  onAddRace, onRenameRace, onRerunRace, runoffTeams, onPickRunoffWinner,
}: ScoringProps) {
  const [sheet, setSheet] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [auditRaceId, setAuditRaceId] = useState<number | null>(null);
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
  const auditOpen = Boolean(activeRace && auditRaceId === activeRace.id);

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
    return state?.place ? pointsFor(state.place, false) : 0;
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
    };
  });

  const hasControls = Boolean(onAddRace || onRenameRace || onRerunRace || (onPickRunoffWinner && runoffTeams && runoffTeams.length > 0));
  const links: ToolLink[] = [
    ...toolLinks.map((l) => ({ ...l, onSelect: () => { setToolsOpen(false); l.onSelect(); } })),
    ...(hasControls ? [{ key: 'organiser', label: 'Organiser tools', sub: 'Rerun, change or cancel a race', onSelect: () => { setToolsOpen(false); setControlsOpen(true); } }] : []),
  ];

  function stepTeam(teamId: number, by: 1 | -1) {
    if (!onOverridePoints) return;
    onOverridePoints(teamId, stepPoints(pointsOf(teamId, false), by));
  }

  return (
    <section className="space-y-3">
      <div className="sc-main">
        {races.length === 0 && <p className="sc-card sc-pad sc-sub">No races in this heat yet.</p>}
        {activeRace && (
          <section key={activeRace.id} className="sc-open" aria-label={`Scoring ${activeRace.name}`}>
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
                    onTap={() => onClickTeam(e.teamId)}
                    onSwipeEliminate={() => onToggleElim(e.teamId)}
                    onToggleElim={() => onToggleElim(e.teamId)}
                  />
                );
              })}
            </ul>

            {live && editing && <p className="sc-hint">Saving again replaces this race’s points.</p>}
            {live && isQualifier && <p className="sc-hint">The first {qualifiers} home go through; the rest score 1 point each.</p>}

            {live && (activeRace.results.length > 0 || activeQueued) && (
              <label className="mt-3 flex flex-col gap-1 text-sm font-semibold">
                Reason for correction
                <textarea className="input min-h-20" maxLength={1000} value={correctionReason} onChange={(event) => onCorrectionReason(event.target.value)} placeholder="What changed, and why?" />
              </label>
            )}

            {canScore && saved && !editing && (
              <div className="sc-bottom">
                <button type="button" className="mg-btn mg-btn-secondary sc-wide-btn" onClick={() => setEditing(true)}>Edit this race</button>
              </div>
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
          factsOn={factsOn}
          onToggleFacts={onToggleFacts}
          links={links}
          onClose={() => setToolsOpen(false)}
        />
      )}
      {controlsOpen && activeRace && (
        <div className="rt-overlay">
          <button type="button" className="rt-scrim" aria-label="Close organiser tools" onClick={() => setControlsOpen(false)} />
          <div role="dialog" aria-modal="true" aria-label="Organiser tools" className="rt-sheet">
            <div className="rt-head">
              <span className="rt-title">Organiser tools</span>
              <button type="button" className="sc-link" onClick={() => setControlsOpen(false)}>Close</button>
            </div>
            <RaceControlsPanel
              raceName={activeRace.name}
              onAddRace={onAddRace}
              onRenameRace={onRenameRace}
              onRerunRace={onRerunRace}
              runoffTeams={runoffTeams}
              onPickRunoffWinner={onPickRunoffWinner}
            />
          </div>
        </div>
      )}
    </section>
  );
}
