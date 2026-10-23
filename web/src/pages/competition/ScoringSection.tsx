import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import { useState } from 'react';
import { CloudOff, Flag, AlertTriangle, Trash2, Trophy, ChevronDown, ChevronUp, Columns3, StickyNote } from 'lucide-react';
import type { Heat, Race } from '../../types';
import { bibAccent } from '../../lib/bib';
import { describePlacings, type QueuedScore } from '../../offline/scoreOutbox';
import type { PendingPlace } from '../../lib/raceScoring';
import { RESULT_STATUS, STATUS_CHOICES, effectiveStatus, statusLetter } from '../../lib/resultStatus';
import { LaneRotationMode, lanesInUse } from '../../lib/lanes';
import { BibSwatch } from '../../components/BibSwatch';
import { inLaneOrder } from '../../lib/laneOrder';
import { displayLaneFor, sitsOutOf, teamForDisplayLane, type LaneRules } from './laneRules';

export type { PendingPlace } from '../../lib/raceScoring';

function LaneGrid({ heat, raceIndex, raceName, rules }: { heat: Heat; raceIndex: number; raceName: string; rules: LaneRules }) {
  const size = heat.entries.length;
  if (size === 0) return null;
  const lanes = Array.from({ length: lanesInUse(size, rules.lanesPerHeat) }, (_, i) => i + 1);
  const sittingOut = heat.entries.filter((e) => sitsOutOf(heat, e, raceIndex, rules));
  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-700 p-2 bg-slate-50/60 dark:bg-slate-800/40">
      <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-300 mb-1 flex items-center gap-1">
        <Columns3 className="w-3 h-3" /> Lanes for {raceName} {raceIndex > 0 && rules.mode !== LaneRotationMode.Stay && <span className="font-normal text-slate-400">(rotated {rules.mode === LaneRotationMode.MoveDown ? '-' : '+'}{raceIndex})</span>}
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
        {lanes.map((laneNum) => {
          const team = teamForDisplayLane(heat, raceIndex, laneNum, rules);
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
      {sittingOut.length > 0 && (
        <p className="mt-1.5 text-[11px] text-slate-600 dark:text-slate-300">
          <span className="font-bold">S</span> Sitting out this race: {sittingOut.map((e) => e.teamName).join(', ')}
        </p>
      )}
    </div>
  );
}

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
  showResults: boolean;
  onToggleResults: () => void;
  showLaneView: boolean;
  onToggleLaneView: () => void;
  onClickTeam: (teamId: number) => void;
  onToggleElim: (teamId: number) => void;
  /** Give a team that did not finish its reason (E, DNS, DNF, R), or 0 to bring it back as a finisher. */
  onSetStatus?: (teamId: number, status: number) => void;
  /** Set the private referee note for a team. Off (undefined) where notes aren't allowed, such as a scorer link. */
  onSetNote?: (teamId: number, note: string) => void;
  onReset: () => void;
  onSubmit: () => void;
  correctionReason: string;
  onCorrectionReason: (reason: string) => void;
  /** Start/Stop for the race clock. Off for scorer links, which can't run the clock. */
}

export function ScoringSection({
  heat, races, activeRace, onSelectRace, sessionBase, laneRules, qualifiers, pending, canScore, queued, showResults,
  onToggleResults, showLaneView, onToggleLaneView, onClickTeam, onToggleElim, onSetStatus, onSetNote, onReset, onSubmit, correctionReason, onCorrectionReason,
}: ScoringProps) {
  // The team whose status and note panel is open. Closed by default so the common tap-in-order flow stays as it was.
  const [statusFor, setStatusFor] = useState<number | null>(null);
  const pendingByTeam = new Map(pending.map((p) => [p.teamId, p]));
  const queuedByRace = new Map(queued.map((q) => [q.raceId, q]));
  const activeQueued = activeRace ? queuedByRace.get(activeRace.id) : undefined;
  const activeRaceIdx = activeRace ? races.findIndex((r) => r.id === activeRace.id) : 0;
  const heatSize = heat.entries.length;
  // A qualifier gives 1 point a finisher; a final is scored on its own field plus one (so last place beats a qualifier's 1).
  const isQualifier = heat.raceRoundStage === 1;
  const scoringBase = heat.raceRoundStage === 2 ? heatSize + 1 : sessionBase;

  function pointsFor(place: number, eliminated: boolean) {
    if (eliminated) return 0;
    if (isQualifier) return 1;
    if (place < 1 || place > scoringBase) return 0;
    return scoringBase - place + 1;
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
          <LaneGrid heat={heat} raceIndex={activeRaceIdx} raceName={activeRace.name} rules={laneRules} />
        )}
      </div>

      {activeRace ? (
        <div className="card p-3">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="font-semibold flex items-center gap-1.5 text-sm flex-1 min-w-0">
              <Flag className="w-4 h-4 text-brand-600 shrink-0" /> Scoring · {activeRace.name}
            </h3>
          </div>
          {activeQueued && (
            <p role="status" className="mb-2 rounded-md bg-amber-50 p-2 text-[11px] text-amber-900">
              Not sent yet: {describePlacings(activeQueued.places, activeQueued.teamNames)}. To change them, score the race again.
            </p>
          )}
          <p className="text-[11px] text-slate-500 dark:text-slate-300 mb-3">
            {isQualifier
              ? <>Tap the first {qualifiers} teams home, in order. The rest score 1 point each; tap one of them to eliminate it (0 pts).</>
              : <>Tap a team to assign its place · swipe a tile <span className="font-semibold">downwards</span> to eliminate (0 pts).</>}
            {onSetStatus && <> For DNS, DNF, retired or a note, use <span className="font-semibold">More</span> under a team.</>}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {inLaneOrder(heat, activeRaceIdx, laneRules).map((e) => {
              const state = pendingByTeam.get(e.teamId);
              const sat = sitsOutOf(heat, e, activeRaceIdx, laneRules);
              const lane = displayLaneFor(heat, e, activeRaceIdx, laneRules);
              return (
                <div key={e.id} className="flex flex-col gap-1">
                  <ScoreTile
                    teamName={e.teamName}
                    lane={lane}
                    colour={bibAccent(e.bibColour)}
                    bibColour={e.bibColour}
                    place={state?.eliminated ? undefined : state?.place}
                    eliminated={state?.eliminated ?? false}
                    letter={state?.eliminated ? statusLetter(true, state.status) ?? 'E' : null}
                    hasNote={Boolean(state?.refereeNote)}
                    disabled={!canScore || sat}
                    onTap={() => onClickTeam(e.teamId)}
                    onSwipeEliminate={() => onToggleElim(e.teamId)}
                  />
                  {canScore && !sat && onSetStatus && (
                    <>
                      <button
                        type="button"
                        className="self-end text-[11px] font-semibold text-slate-500 underline-offset-2 hover:underline dark:text-slate-300"
                        aria-expanded={statusFor === e.teamId}
                        aria-label={`More for ${e.teamName}`}
                        onClick={() => setStatusFor(statusFor === e.teamId ? null : e.teamId)}
                      >
                        More
                      </button>
                      {statusFor === e.teamId && (
                        <StatusPanel
                          teamName={e.teamName}
                          state={state}
                          onSetStatus={(status) => onSetStatus(e.teamId, status)}
                          onSetNote={onSetNote ? (note) => onSetNote(e.teamId, note) : undefined}
                        />
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {canScore && (activeRace.results.length > 0 || activeQueued) && (
            <label className="mt-3 flex flex-col gap-1 text-sm font-semibold">
              Reason for correction
              <textarea className="input min-h-20" maxLength={1000} value={correctionReason} onChange={(event) => onCorrectionReason(event.target.value)} placeholder="What changed, and why?" />
            </label>
          )}
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
          {p.eliminated ? `0 ${statusLetter(true, p.status) ?? 'E'}` : `${p.place} (${pointsFor(p.place, false)})`}
        </span>;
      }
    }
    const r = race.results.find((x) => x.teamId === teamId);
    if (!r) return <span className="text-slate-400">—</span>;
    if (r.eliminated) return <span className="text-rose-500">0 {statusLetter(true, r.status)}</span>;
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
  lane: number | string;
  colour: string;
  bibColour?: string | null;
  place?: number;
  eliminated: boolean;
  /** E, DNS, DNF or R for a team that did not finish. */
  letter?: string | null;
  /** A private referee note is attached. Only the fact is shown, never the text. */
  hasNote?: boolean;
  disabled: boolean;
  onTap: () => void;
  onSwipeEliminate: () => void;
}

function ScoreTile({
  teamName, lane, colour, bibColour, place, eliminated, letter, hasNote, disabled, onTap, onSwipeEliminate,
}: ScoreTileProps) {
  function handlePanEnd(_e: unknown, info: PanInfo) {
    if (disabled) return;
    if (info.offset.y > 50 && info.velocity.y > 0) {
      onSwipeEliminate();
    }
  }

  const base = 'relative select-none touch-pan-y p-3 rounded-xl text-left font-semibold border-2 transition min-h-[72px]';
  const style = eliminated
    ? 'bg-rose-100 border-rose-500 text-rose-900'
    : place != null
      ? 'bg-brand-600 border-brand-700 text-white shadow-card'
      : 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-900 dark:text-slate-50';

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
        <div className="text-sm leading-tight flex-1 min-w-0">
          <div>{teamName}</div>
          <BibSwatch colour={bibColour} className="mt-0.5" />
        </div>
        {hasNote && <StickyNote className="w-3.5 h-3.5 shrink-0 opacity-80" aria-label="Has a referee note" />}
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
            <AlertTriangle className="w-2.5 h-2.5" /> {letter === 'E' || !letter ? 'ELIM' : letter}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

interface StatusPanelProps {
  teamName: string;
  state: PendingPlace | undefined;
  onSetStatus: (status: number) => void;
  onSetNote?: (note: string) => void;
}

/** The less common results for one team: why it did not finish, and a private note for staff. */
function StatusPanel({ teamName, state, onSetStatus, onSetNote }: StatusPanelProps) {
  const current = state ? effectiveStatus(state.eliminated, state.status) : RESULT_STATUS.Finished;
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px] dark:border-slate-600 dark:bg-slate-800/60" role="group" aria-label={`Result for ${teamName}`}>
      <div className="flex flex-wrap gap-1">
        {STATUS_CHOICES.map((choice) => (
          <button
            key={choice.value}
            type="button"
            title={choice.label}
            aria-pressed={current === choice.value}
            className={`rounded px-2 py-1 font-bold ${current === choice.value ? 'bg-rose-600 text-white' : 'bg-white text-slate-700 dark:bg-slate-700 dark:text-slate-100'}`}
            onClick={() => onSetStatus(choice.value)}
          >
            {choice.letter}
          </button>
        ))}
        {current !== RESULT_STATUS.Finished && (
          <button type="button" className="rounded bg-white px-2 py-1 font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-100" onClick={() => onSetStatus(RESULT_STATUS.Finished)}>
            Finished
          </button>
        )}
      </div>
      {onSetNote && (
        <label className="mt-2 flex flex-col gap-1 font-semibold">
          Referee note (staff only)
          <textarea
            className="input min-h-14"
            maxLength={500}
            disabled={!state}
            value={state?.refereeNote ?? ''}
            placeholder={state ? 'Seen only by the organisers' : 'Give the team a place or a letter first'}
            onChange={(event) => onSetNote(event.target.value)}
          />
        </label>
      )}
    </div>
  );
}
