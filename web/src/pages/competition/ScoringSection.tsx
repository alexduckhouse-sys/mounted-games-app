import { useCallback, useState, useSyncExternalStore } from 'react';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import { CloudOff, Flag, AlertTriangle, Trash2, Trophy, ChevronDown, ChevronUp, Clock, Columns3 } from 'lucide-react';
import { api } from '../../api';
import type { Heat, HeatEntry, Race } from '../../types';
import { bibAccent } from '../../lib/bib';
import { retryOnNetworkError } from '../../lib/liveUpdates';
import { describePlacings, type QueuedScore } from '../../offline/scoreOutbox';

function displayLaneFor(baseLane: number, raceIndex: number, heatSize: number): number {
  if (heatSize <= 0) return baseLane;
  return ((baseLane - 1 + raceIndex) % heatSize) + 1;
}

function teamForDisplayLane(heat: Heat, raceIndex: number, displayLane: number): HeatEntry | null {
  const size = heat.entries.length;
  if (size <= 0) return null;
  return heat.entries.find((e) => displayLaneFor(e.laneIndex, raceIndex, size) === displayLane) ?? null;
}

export interface PendingPlace {
  teamId: number;
  place: number;
  eliminated: boolean;
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
  correctionReason: string;
  onCorrectionReason: (reason: string) => void;
  /** Start/Stop for the race clock. Off for scorer links, which can't run the clock. */
  showClock?: boolean;
}

export function ScoringSection({
  heat, races, activeRace, onSelectRace, sessionBase, pending, canScore, queued, showResults,
  onToggleResults, showLaneView, onToggleLaneView, onClickTeam, onToggleElim, onReset, onSubmit, correctionReason, onCorrectionReason, showClock = true,
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
            {showClock && <RaceClock key={activeRace.id} race={activeRace} />}
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


/**
 * Live race clock — Start/Stop buttons + an elapsed timer that ticks every
 * second while the race is running. Optimistic: shows the tap at once and
 * sends the tap time, so a slow connection doesn't shift the race time.
 */
// A once-a-second clock for the running race timer, read through useSyncExternalStore so that
// rendering never calls Date.now() itself.
let clockNow = Date.now();
function useClock(active: boolean): number {
  const subscribe = useCallback((notify: () => void) => {
    if (!active) return () => {};
    clockNow = Date.now(); // the first reading after subscribing is current
    const timer = setInterval(() => { clockNow = Date.now(); notify(); }, 1000);
    return () => clearInterval(timer);
  }, [active]);
  return useSyncExternalStore(subscribe, () => clockNow);
}

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
  const now = useClock(running);

  function elapsed(): string {
    if (!started) return '—';
    const end = finished?.getTime() ?? now;
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

