/* eslint-disable react-refresh/only-export-components */
import { motion, type PanInfo } from 'framer-motion';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useDialogFocus } from '../../components/useDialogFocus';
import { BibSwatch } from '../../components/BibSwatch';
import { dotColour } from '../../lib/teamColours';
import type { LaneFill } from '../../lib/laneFill';
import { hatbandColour } from '../../lib/hatbands';
import { RaceSelect } from '../../components/RacePicker';
import { Notice } from '../../components/Notice';
import { Sheet } from '../../components/Sheet';
import { ELIM_REASONS, OTHER_REASON, noteFor, reasonKeyOf, statusFor } from '../../lib/elimReasons';
import { RESULT_STATUS } from '../../lib/resultStatus';
import { inLaneOrder } from '../../lib/laneOrder';
import type { NextLanes } from '../../lib/nextRoundLanes';
import type { PendingPlace } from '../../lib/raceScoring';
import type { RaceSummary } from '../../lib/raceSummary';
import { statusLetter, statusLabel } from '../../lib/resultStatus';
import { ordinal } from '../../lib/toplist';
import type { Heat, HeatEntry, Race } from '../../types';
import { displayLaneFor, sitsOutOf, type LaneRules } from './laneRules';
import './heat.css';
import './scoring.css';
import { formatPoints } from '../../lib/formatPoints';
import { triggerScorerHaptic } from '../../lib/userPrefs';
import { useSwipeToClose } from '../../hooks/useSwipeToClose';

export interface ScoreOverrideValue {
  points: number;
  reason?: string;
}

export type RefereeCard = 'yellow' | 'red' | null;

/** Whether disciplinary cards (Yellow / Red) are shown for this competition on this device. Defaults to false. */
export function isCardsEnabled(competitionId?: number | null): boolean {
  if (!competitionId) return false;
  try {
    return localStorage.getItem(`mg.cardsEnabled.${competitionId}`) === '1';
  } catch {
    return false;
  }
}

/** Enables or disables disciplinary cards (Yellow / Red) for a competition and notifies listeners. */
export function setCardsEnabled(competitionId: number | null | undefined, enabled: boolean): void {
  if (!competitionId) return;
  try {
    localStorage.setItem(`mg.cardsEnabled.${competitionId}`, enabled ? '1' : '0');
    window.dispatchEvent(new CustomEvent('mg:cards-config-changed', { detail: { competitionId, enabled } }));
    window.dispatchEvent(new CustomEvent('mg-cards-updated', { detail: { competitionId } }));
  } catch {
    // Ignore storage errors.
  }
}

/** Reactive hook for reading and updating whether disciplinary cards are enabled for a competition. */
export function useCardsEnabled(competitionId?: number | null): [boolean, (enabled: boolean) => void] {
  const [, setTick] = useState(0);
  useEffect(() => {
    function onChange() { setTick((t) => t + 1); }
    window.addEventListener('mg:cards-config-changed', onChange);
    window.addEventListener('mg-cards-updated', onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener('mg:cards-config-changed', onChange);
      window.removeEventListener('mg-cards-updated', onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);
  const enabled = isCardsEnabled(competitionId);
  const update = (next: boolean) => setCardsEnabled(competitionId, next);
  return [enabled, update];
}

export function TeamCardBadge({ card }: { card?: RefereeCard }) {
  if (card === 'yellow') {
    return <span role="img" aria-label="Yellow card" title="Yellow card" className="ml-1 inline-block select-none text-xs">🟨</span>;
  }
  if (card === 'red') {
    return <span role="img" aria-label="Red card" title="Red card" className="ml-1 inline-block select-none text-xs">🟥</span>;
  }
  return null;
}

/** Checks if a referee note starts with [YC] or [RC] and returns the card type plus clean note. */
export function parseRefereeCard(note: string | null | undefined): { card: RefereeCard; cleanNote: string } {
  if (!note) return { card: null, cleanNote: '' };
  const match = /^\s*\[(YC|RC)\]\s*(.*)$/i.exec(note);
  if (match) {
    const card: RefereeCard = match[1].toUpperCase() === 'YC' ? 'yellow' : 'red';
    return { card, cleanNote: match[2].trim() };
  }
  return { card: null, cleanNote: note.trim() };
}

/** Reads stored cards from localStorage for immediate client-side badging. */
export function getStoredCards(competitionId?: number | null): Record<number, 'yellow' | 'red'> {
  if (!competitionId) return {};
  try {
    const raw = localStorage.getItem(`mg.cards.${competitionId}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Saves or clears a team's card in localStorage and dispatches an event. */
export function setStoredCard(competitionId: number | null | undefined, teamId: number, card: RefereeCard): void {
  if (!competitionId) return;
  try {
    const cards = getStoredCards(competitionId);
    if (card) {
      cards[teamId] = card;
    } else {
      delete cards[teamId];
    }
    localStorage.setItem(`mg.cards.${competitionId}`, JSON.stringify(cards));
    window.dispatchEvent(new CustomEvent('mg-cards-updated', { detail: { competitionId, teamId, card } }));
  } catch {
    // Ignore storage errors.
  }
}

/** Plays a subtle two-tone audio chime and short haptic pulse for urgent scorer/organiser alerts. */
export function playAlertChime(): void {
  triggerScorerHaptic([80, 40, 120]);
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now); // D5
    gain1.gain.setValueAtTime(0.12, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.15);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.1); // A5
    gain2.gain.setValueAtTime(0.15, now + 0.1);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.35);

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 450);
  } catch {
    // Graceful no-op in test environments without audio support.
  }
}

/** How long a finger has to rest on a lane before it is eliminated. The red fill only starts after 250 ms (in scoring.css), so a quick tap never shows red. */
export const HOLD_ELIMINATE_MS = 600;

/** A small card or HC mark beside a team's name. */
export function CardChip({ card, hc }: { card?: RefereeCard; hc?: boolean }) {
  return (
    <>
      {card === 'yellow' && <span role="img" aria-label="Yellow card" className="sc-chip sc-chip-yellow" />}
      {card === 'red' && <span role="img" aria-label="Red card" className="sc-chip sc-chip-red" />}
      {hc && <span className="sc-chip-hc" aria-label="Hors concours">HC</span>}
    </>
  );
}

/** The 10px band down the left of a lane card, in the lane's hatband colour (the bib colour when the event sets no hatbands). */
export function LaneBand({ hatband, bib }: { hatband?: string | null; bib?: string | null }) {
  const colour = hatband?.trim() ? hatbandColour(hatband) : dotColour(bib);
  return <span className="sc-band" aria-hidden="true" style={{ background: colour }} />;
}

/** The short buzz a lane tap gives (unless the scorer has turned haptics off). A keypad press gives the same. */
export function tapHaptic(): void {
  triggerScorerHaptic(15);
}

/** One team in the race being scored. A tap places it (or takes it off again); pressing and holding eliminates it. */
export function ScoreRow({
  entry, lane, hatband, state, sitting, hc, canScore, points = 0, overridePoints,
  card, fact, last = false, fill = null,
  onTap, onSwipeEliminate, onToggleElim,
}: {
  entry: HeatEntry;
  lane: string;
  hatband?: string | null;
  state?: PendingPlace;
  sitting: boolean;
  hc: boolean;
  canScore: boolean;
  points?: number;
  overridePoints?: number;
  card?: RefereeCard;
  /** The commentator's line for this team, shown small and blue under the name. */
  fact?: string;
  /** The only racing lane still to be scored: picked out quietly, never placed for the scorer. */
  last?: boolean;
  /** Paints the whole box in the team's bib colour (the scorer's "Full colour lanes" choice). Null keeps the normal box. */
  fill?: LaneFill | null;
  onTap: () => void;
  onSwipeEliminate: () => void;
  onToggleElim: () => void;
}) {
  const eliminated = state?.eliminated ?? false;
  const placed = Boolean(state?.place && !eliminated);
  const disabled = !canScore || sitting;
  const dragged = useRef(false);
  const held = useRef(false);
  const holdTimer = useRef<number | null>(null);
  // Places already there when the card opens stay still; only a place the scorer sets now springs in.
  const [openedWith] = useState(() => (eliminated ? 'E' : state?.place ?? null));
  const [holding, setHolding] = useState(false);

  function clearHold() {
    if (holdTimer.current != null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    setHolding(false);
  }

  useEffect(() => () => {
    if (holdTimer.current != null) window.clearTimeout(holdTimer.current);
  }, []);

  function handlePointerDown() {
    if (disabled) return;
    clearHold();
    held.current = false;
    dragged.current = false;
    setHolding(true);
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null;
      held.current = true;
      setHolding(false);
      onToggleElim();
    }, HOLD_ELIMINATE_MS);
  }

  function handlePanEnd(_e: unknown, info: PanInfo) {
    clearHold();
    if (Math.abs(info.offset.y) > 8) dragged.current = true;
    if (!disabled && !held.current && info.offset.y > 50 && info.velocity.y > 0) onSwipeEliminate();
  }

  function handleClick() {
    clearHold();
    if (held.current) {
      held.current = false;
      return;
    }
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    if (!disabled) {
      tapHaptic();
      onTap();
    }
  }

  const badge = sitting ? (
    <span className="sc-badge-sit" aria-label="Sitting out">S</span>
  ) : eliminated ? (
    <span key="E" className={`sc-place sc-place-out${openedWith === 'E' ? '' : ' sc-place-pop'}`} aria-label={statusLabel(true, state?.status) ?? 'Eliminated'}>
      {statusLetter(true, state?.status) ?? 'E'}
    </span>
  ) : state?.place ? (
    <span key={state.place} className={`sc-place${openedWith === state.place ? '' : ' sc-place-pop'}`} aria-label={`Place ${state.place}`}>{state.place}</span>
  ) : null;

  return (
    <li
      className={`sc-row ${placed ? 'sc-row-placed' : ''} ${eliminated ? 'sc-row-out' : ''} ${sitting ? 'sc-row-sit' : ''} ${last ? 'sc-row-last' : ''} ${fill ? 'sc-row-fill' : ''}`}
      style={fill ? ({ '--lane-fill': fill.colour, '--lane-ink': fill.ink, '--lane-ink-soft': fill.inkSoft } as CSSProperties) : undefined}
    >
      {holding && <span className="sc-hold" aria-hidden="true" />}
      <motion.button
        type="button"
        className="sc-main-btn"
        disabled={disabled}
        aria-label={`${entry.teamName}, lane ${lane}${hc ? ', hors concours' : ''}${last ? ', last lane to score' : ''}`}
        drag={!disabled ? 'y' : false}
        dragSnapToOrigin
        dragElastic={0.4}
        dragConstraints={{ top: 0, bottom: 80 }}
        onPointerDown={handlePointerDown}
        onPointerUp={clearHold}
        onPointerLeave={clearHold}
        onPointerCancel={clearHold}
        onContextMenu={(e) => e.preventDefault()}
        onPanStart={clearHold}
        onPanEnd={handlePanEnd}
        onClick={handleClick}
        // LANE_CARD_ATTR in lib/scoringKeys.ts: Enter on a focused card saves instead of tapping it again.
        data-scoring-lane={lane}
        // Delete or Backspace on a focused card eliminates that lane. It marks the key as used, so the keypad
        // listener (useScoringKeys, where Backspace means undo) skips it: a card someone has moved to on purpose
        // wins over the keypad shortcut. With no card focused, Backspace undoes.
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Delete' || e.key === 'Backspace')) {
            e.preventDefault();
            onToggleElim();
          }
        }}
      >
        <LaneBand hatband={hatband} bib={entry.bibColour} />
        <span className="sc-lane" title={`Lane ${lane}`}>{sitting ? lane : `L${lane}`}</span>
        <span className="sc-who">
          <span className="sc-name-row">
            <span className="sc-name">{entry.teamName}</span>
            <CardChip card={card} hc={hc} />
            {overridePoints != null && !hc && <span className="sc-tag sc-tag-manual">{formatPoints(points)} pts by hand</span>}
            {last && <span className="sc-tag sc-tag-last" aria-hidden="true">Last to score</span>}
          </span>
          {fact && <span className="sc-fact">{fact}</span>}
        </span>
        {badge}
      </motion.button>
    </li>
  );
}

/**
 * A bottom dialog on the scoring screen that closes when it is swiped down (the same hook as `components/Sheet`). Focus
 * moves in to `focus` and stays inside; Escape closes it.
 */
export function PullDownDialog({ label, className, onClose, focus = 'button', children }: { label: string; className: string; onClose: () => void; focus?: string; children: ReactNode }) {
  const { ref, handlers, style, dragging } = useSwipeToClose<HTMLDivElement>(onClose);
  useDialogFocus(ref, onClose, focus);
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label={label} className={dragging ? `${className} is-dragging` : className} style={style} {...handlers} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}

function Overlay({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sc-overlay" onClick={onClose}>
      <PullDownDialog label={label} className="sc-sheet" onClose={onClose}>{children}</PullDownDialog>
    </div>
  );
}

/** Organiser tools for the race being scored: change it, add one, re-run it, or record a run-off winner. */
export function RaceControlsPanel({
  raceName, onAddRace, onRenameRace, onRerunRace, runoffTeams, onPickRunoffWinner,
}: {
  raceName: string;
  onAddRace?: (raceName: string) => Promise<void> | void;
  onRenameRace?: (newName: string) => Promise<void> | void;
  onRerunRace?: () => Promise<void> | void;
  runoffTeams?: Array<{ id: number; name: string }>;
  onPickRunoffWinner?: (teamId: number) => Promise<void> | void;
}) {
  const [runoffTeamId, setRunoffTeamId] = useState<number | null>(runoffTeams?.[0]?.id ?? null);
  return (
    <div className="space-y-3">
      {onRenameRace && (
        <div className="space-y-1.5">
          <span className="text-xs font-semibold text-[rgb(var(--mg-heading))]">Change this race ({raceName})</span>
          <RaceSelect
            label="New race name"
            submitLabel="Change race"
            placeholder="Search replacement race…"
            autoReset
            onSelect={(nextName) => { void onRenameRace(nextName); }}
          />
        </div>
      )}
      {onAddRace && (
        <div className="space-y-1.5">
          <span className="text-xs font-semibold text-[rgb(var(--mg-heading))]">Add a race to this session</span>
          <RaceSelect
            label="Race to add"
            submitLabel="Add race"
            placeholder="Search race to add…"
            autoReset
            onSelect={(nextName) => { void onAddRace(nextName); }}
          />
        </div>
      )}
      {onRerunRace && (
        <button type="button" className="sc-link-red" onClick={() => { void onRerunRace(); }}>
          Re-run stopped race ({raceName} · Re-run)
        </button>
      )}
      {onPickRunoffWinner && runoffTeams && runoffTeams.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs font-semibold text-[rgb(var(--mg-heading))]">Record run-off winner</span>
          <div className="flex gap-2">
            <select
              aria-label="Run-off winning team"
              className="mg-field !min-h-10 flex-1 px-2 text-sm"
              value={runoffTeamId ?? ''}
              onChange={(e) => setRunoffTeamId(e.target.value ? Number(e.target.value) : null)}
            >
              {runoffTeams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <button
              type="button"
              className="mg-btn mg-btn-secondary !min-h-10 !px-3 !text-xs"
              disabled={!runoffTeamId}
              onClick={() => { if (runoffTeamId) void onPickRunoffWinner(runoffTeamId); }}
            >
              Save winner
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** When a race is marked complete: why each eliminated team is out. Kept as the team's private referee note. */
export function EliminationSheet({ places, names, onSave, onSkip, onCancel }: {
  places: PendingPlace[];
  names: Record<number, string>;
  onSave: (places: PendingPlace[]) => void;
  onSkip: () => void;
  onCancel: () => void;
}) {
  const out = places.filter((p) => p.eliminated);
  const [choice, setChoice] = useState<Record<number, { key: string | null; text: string }>>(() => Object.fromEntries(
    out.map((p) => {
      const key = reasonKeyOf(p.refereeNote) ?? (p.status && p.status > 1 ? ELIM_REASONS.find((r) => r.status === p.status)?.key ?? null : null);
      return [p.teamId, { key, text: key === OTHER_REASON ? p.refereeNote ?? '' : '' }];
    }),
  ));
  const complete = out.every((p) => {
    const c = choice[p.teamId];
    return c?.key && (c.key !== OTHER_REASON || c.text.trim());
  });
  function save() {
    onSave(places.map((p) => {
      const c = choice[p.teamId];
      return p.eliminated && c?.key ? { ...p, status: statusFor(c.key), refereeNote: noteFor(c.key, c.text) } : p;
    }));
  }
  return (
    <Overlay label="Why were teams eliminated?" onClose={onCancel}>
      <h3 className="sc-title">Why are they out?</h3>
      <p className="sc-sub mt-1">Saved as a private note for staff, and read out in the summary.</p>
      {out.map((p) => (
        <div key={p.teamId} className="sc-field">
          <span className="sc-name">{names[p.teamId] ?? 'Unnamed team'}</span>
          <div className="sc-choices sc-reasons" role="group" aria-label={`Reason for ${names[p.teamId] ?? p.teamId}`}>
            {ELIM_REASONS.map((r) => (
              // Faults come first; the non-finishes and Other start a new row of their own.
              <button key={r.key} type="button" className="sc-choice" data-kind={r.status === RESULT_STATUS.Eliminated && r.key !== OTHER_REASON ? undefined : 'finish'}
                aria-pressed={choice[p.teamId]?.key === r.key}
                onClick={() => setChoice((c) => ({ ...c, [p.teamId]: { key: r.key, text: c[p.teamId]?.text ?? '' } }))}>
                {r.label}
              </button>
            ))}
          </div>
          {choice[p.teamId]?.key === OTHER_REASON && (
            <input className="input min-h-11" maxLength={300} aria-label={`Other reason for ${names[p.teamId] ?? p.teamId}`} placeholder="What happened?"
              value={choice[p.teamId]?.text ?? ''} onChange={(e) => setChoice((c) => ({ ...c, [p.teamId]: { key: OTHER_REASON, text: e.target.value } }))} />
          )}
        </div>
      ))}
      <div className="sc-actions">
        <button type="button" className="mg-btn mg-btn-primary" disabled={!complete} onClick={save}>Save race</button>
        <button type="button" className="mg-btn mg-btn-secondary" onClick={onSkip}>Save without reasons</button>
        <button type="button" className="mg-btn mg-btn-secondary" onClick={onCancel}>Back</button>
      </div>
    </Overlay>
  );
}

/** What the announcer says after a race. */
export function SummaryCard({ summary, raceNumber }: { summary: RaceSummary; raceNumber: number }) {
  return (
    <section className="sc-card sc-say sc-pad" aria-label={`Announcer summary for ${summary.raceName}`}>
      <h3 className="sc-title">Say this after race {raceNumber}</h3>
      <p className="sc-sub">{summary.raceName}</p>
      <h4>Placings</h4>
      <ol>
        {summary.placings.map((p) => <li key={p.teamId}>{ordinal(p.place)} {p.teamName}{p.hc ? ' (HC)' : ''}, {formatPoints(p.points)} {p.points === 1 ? 'point' : 'points'}</li>)}
      </ol>
      {summary.out.length > 0 && <>
        <h4>Out</h4>
        <ul>{summary.out.map((o) => <li key={o.teamId}>{o.teamName}: {o.reason}</li>)}</ul>
      </>}
      <h4>Heat totals so far</h4>
      <ol>
        {summary.totals.map((t) => <li key={t.teamId}>{t.hc ? `${t.teamName}: HC, ${formatPoints(t.points)} points` : `${ordinal(t.position ?? 0)} ${t.teamName}: ${formatPoints(t.points)} ${t.points === 1 ? 'point' : 'points'}${t.why ? ` (tie-break: ${t.why})` : ''}`}</li>)}
      </ol>
      {summary.ending && <>
        <h4>{summary.ending.heading}</h4>
        <ul>{summary.ending.lines.map((l) => <li key={l}>{l}</li>)}</ul>
      </>}
    </section>
  );
}

/** The lanes for the next part of the day. */
export function NextLanesCard({ lanes }: { lanes: NextLanes }) {
  return (
    <section className="sc-card sc-pad" aria-label={lanes.title}>
      <h3 className="sc-title">{lanes.title}</h3>
      {lanes.note && (lanes.provisional ? <Notice tone="info" className="mt-2">{lanes.note}</Notice> : <p className="sc-sub">{lanes.note}</p>)}
      <ol className="sc-rows mt-1">
        {lanes.rows.map((r) => (
          <li key={`${r.lane}-${r.teamId}`} className="sc-lane-item">
            <span className="sc-lane">{r.lane}</span>
            <span className="sc-who"><span className="sc-name">{r.teamName}</span><BibSwatch colour={r.bibColour} /></span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The heat's scores in the same look as the public heat table. Rows are in lane order for the race being scored. */
export function HeatGrid({ heat, races, activeRaceId, activeIndex, rules, pending, pointsFor, hcTeamIds, cardsByTeam }: {
  heat: Heat;
  races: Race[];
  activeRaceId: number | null;
  activeIndex: number;
  rules: LaneRules;
  pending: PendingPlace[];
  pointsFor: (place: number, eliminated: boolean) => number;
  hcTeamIds: ReadonlySet<number>;
  cardsByTeam?: Record<number, RefereeCard>;
}) {
  const teams = inLaneOrder(heat, activeIndex, rules);
  const manyRaces = races.length >= 6;
  const minWidth = manyRaces ? undefined : 12 + 100 + races.length * 22 + 40;
  const activeRace = races.find((r) => r.id === activeRaceId) ?? null;
  const allDone = races.length > 0 && races.every((r) => r.isComplete);
  const metaText = activeRace
    ? `Race ${activeIndex + 1} of ${races.length} · ${activeRace.name}`
    : allDone
      ? 'Final result'
      : `${races.filter((r) => r.isComplete).length} of ${races.length} races scored`;

  function pointsInRace(race: Race, raceIdx: number, entry: HeatEntry): number {
    if (sitsOutOf(heat, entry, raceIdx, rules) || hcTeamIds.has(entry.teamId)) return 0;
    if (race.id === activeRaceId) {
      const p = pending.find((x) => x.teamId === entry.teamId);
      if (p) {
        if (p.eliminated) return 0;
        if (p.points !== undefined) return p.points;
        return p.place > 0 ? pointsFor(p.place, false) : 0;
      }
    }
    return race.results.find((x) => x.teamId === entry.teamId)?.points ?? 0;
  }

  function cellFor(race: Race, raceIdx: number, entry: HeatEntry): ReactNode {
    if (race.id === activeRaceId) {
      if (sitsOutOf(heat, entry, raceIdx, rules)) return <span className="heat-dash sitout">S</span>;
      const p = pending.find((x) => x.teamId === entry.teamId);
      if (p) {
        if (p.eliminated) return <span className="heat-elim">{statusLetter(true, p.status) ?? 'E'}</span>;
        if (p.place > 0) {
          const pts = hcTeamIds.has(entry.teamId) ? 0 : p.points !== undefined ? p.points : pointsFor(p.place, false);
          return <>{formatPoints(pts)}</>;
        }
      }
    }
    const r = race.results.find((x) => x.teamId === entry.teamId);
    if (r) {
      if (r.isSitOut) return <span className="heat-dash sitout">S</span>;
      if (r.eliminated) return <span className="heat-elim">{statusLetter(true, r.status)}</span>;
      return <>{formatPoints(r.points)}</>;
    }
    if (sitsOutOf(heat, entry, raceIdx, rules)) return <span className="heat-dash sitout">S</span>;
    return <span className="heat-dash">–</span>;
  }

  return (
    <section aria-label="Heat table" className="sc-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className={`heat-grid${manyRaces ? ' heat-grid-many' : ''}`} style={{ minWidth }}>
          <thead>
            <tr>
              <th scope="col" className="heat-team-head">
                <div className="heat-title">
                  <span className="heat-title-name">{heat.label || 'Heat'}</span>
                  <span className={`heat-title-meta ${activeRace ? 'heat-title-meta-live' : ''}`}>{metaText}</span>
                </div>
                <span>Team</span>
              </th>
              {races.map((r, i) => (
                <th key={r.id} scope="col" className="heat-race" title={r.name}>
                  {i > 0 && <span aria-hidden="true" className="heat-sep" />}
                  <span className={`heat-name ${r.id === activeRaceId ? 'heat-name-running' : ''}`}>{r.name}</span>
                </th>
              ))}
              <th scope="col" className="heat-pts">{races.length > 0 && <span aria-hidden="true" className="heat-sep" />}Pts</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => {
              const total = races.reduce((sum, r, idx) => sum + pointsInRace(r, idx, t), 0);
              const card = cardsByTeam?.[t.teamId];
              const lane = displayLaneFor(heat, t, activeIndex, rules);
              return (
                <tr key={t.teamId}>
                  <th scope="row" className="heat-team" title={t.teamName}>
                    <div className="heat-team-link">
                      <span className={`heat-team-name${t.teamName.length > 16 || manyRaces ? ' heat-team-name-long' : ''}`}>
                        <span aria-hidden="true" className="mr-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full align-middle" style={{ background: dotColour(t.bibColour) }} />
                        {t.teamName}
                        <TeamCardBadge card={card} />
                        {hcTeamIds.has(t.teamId) ? ' (HC)' : ''}
                      </span>
                      <span className="heat-team-lane">{lane === 'S' ? 'Sit out' : `Lane ${lane}`}</span>
                    </div>
                  </th>
                  {races.map((r, i) => <td key={r.id} className={`heat-cell ${i === 0 ? 'heat-cell-first' : ''}`}>{cellFor(r, i, t)}</td>)}
                  <td className="heat-total">{formatPoints(total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export interface ScoreClashPlace {
  teamId: number;
  place: number;
  eliminated: boolean;
  points?: number;
  status?: number | null;
}

export interface ScoreClashItem {
  raceId: number;
  raceName: string;
  raceOrder?: number;
  heatId?: number;
  sessionId?: number;
  existingPlaces: ScoreClashPlace[];
  incomingPlaces: ScoreClashPlace[];
}

function formatClashPlace(p: ScoreClashPlace): string {
  if (p.eliminated) {
    const letter = statusLetter(true, p.status ?? undefined);
    return letter === 'E' || !letter ? 'OUT' : letter;
  }
  return p.place > 0 ? ordinal(p.place) : '–';
}

function sortClashPlaces(places: ScoreClashPlace[]): ScoreClashPlace[] {
  return [...places].sort((a, b) => {
    if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
    const pa = a.place > 0 ? a.place : 99;
    const pb = b.place > 0 ? b.place : 99;
    return pa - pb || a.teamId - b.teamId;
  });
}

export function ScoreClashBanner({
  clashes,
  teamNamesById,
  onResolve,
}: {
  clashes: ScoreClashItem[];
  teamNamesById: Readonly<Record<number, string>>;
  onResolve: (clash: ScoreClashItem, useIncoming: boolean) => Promise<void> | void;
}) {
  const [busyRaceId, setBusyRaceId] = useState<number | null>(null);
  const prevClashesLength = useRef(0);

  useEffect(() => {
    if (clashes.length > prevClashesLength.current) {
      playAlertChime();
    }
    prevClashesLength.current = clashes.length;
  }, [clashes.length]);

  if (clashes.length === 0) return null;

  async function handlePick(clash: ScoreClashItem, useIncoming: boolean) {
    setBusyRaceId(clash.raceId);
    try {
      await onResolve(clash, useIncoming);
    } finally {
      setBusyRaceId(null);
    }
  }

  const clash = clashes[0];
  const busy = busyRaceId === clash.raceId;
  const sideA = sortClashPlaces(clash.existingPlaces);
  const sideB = sortClashPlaces(clash.incomingPlaces);
  const sides = [
    { key: 'A', heading: 'Result A (Saved)', places: sideA, useIncoming: false },
    { key: 'B', heading: 'Result B (Submitted)', places: sideB, useIncoming: true },
  ];
  return (
    <Sheet
      key={clash.raceId}
      title={`Two results for ${clash.raceOrder ? `Race ${clash.raceOrder}` : clash.raceName}`}
      description="Two scorers sent different placings. Tap the right one."
      dismissible={false}
      onClose={() => undefined}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {sides.map((side) => (
          <div key={side.key} className="flex flex-col justify-between gap-3 rounded-xl border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-ground))] p-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-[rgb(var(--mg-muted))]">{side.heading}</div>
              <ol className="m-0 mt-2 list-none space-y-1 p-0 text-sm">
                {side.places.map((p) => (
                  <li key={p.teamId} className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold text-[rgb(var(--mg-ink))]">{teamNamesById[p.teamId] ?? 'Unnamed team'}</span>
                    <span className="shrink-0 font-bold text-[rgb(var(--mg-heading))]">{formatClashPlace(p)}</span>
                  </li>
                ))}
              </ol>
            </div>
            <button type="button" disabled={busy} onClick={() => void handlePick(clash, side.useIncoming)} className="kit-pill w-full">
              Keep result {side.key}
            </button>
          </div>
        ))}
      </div>
      {clashes.length > 1 && <p className="kit-sheet-text">{clashes.length - 1} more {clashes.length === 2 ? 'race is' : 'races are'} waiting after this one.</p>}
    </Sheet>
  );
}
