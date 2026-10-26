/* eslint-disable react-refresh/only-export-components */
import { motion, type PanInfo } from 'framer-motion';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BibSwatch, HatbandSwatch } from '../../components/BibSwatch';
import { dotColour } from '../../lib/teamColours';
import { hatbandBoxStyle } from '../../lib/hatbands';
import { RaceRulesButton } from '../../components/RaceRulesButton';
import { RaceSelect } from '../../components/RacePicker';
import { ELIM_REASONS, OTHER_REASON, noteFor, reasonKeyOf, statusFor } from '../../lib/elimReasons';
import { hatbandFor, inLaneOrder } from '../../lib/laneOrder';
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

/** Formats a referee note with the [YC] or [RC] prefix when a card is selected. */
export function formatRefereeCardNote(card: RefereeCard, cleanNote: string): string {
  const clean = cleanNote.replace(/^\s*\[(YC|RC)\]\s*/i, '').trim();
  if (card === 'yellow') return clean ? `[YC] ${clean}` : '[YC]';
  if (card === 'red') return clean ? `[RC] ${clean}` : '[RC]';
  return clean;
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
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate && localStorage.getItem('mg.prefs.scorerHaptics') !== '0') {
      navigator.vibrate([80, 40, 120]);
    }
  } catch {
    // Ignore vibration errors.
  }
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

/** One team in the race being scored. A tap places it (or restores an eliminated team); a press-and-hold or swipe down eliminates it. */
export function ScoreRow({
  entry, lane, hatband, state, sitting, hc, canScore, points = 0, heatTotal = 0, overridePoints,
  card,
  onTap, onSwipeEliminate, onToggleElim,
}: {
  entry: HeatEntry;
  lane: string;
  hatband?: string | null;
  state?: PendingPlace;
  sitting: boolean;
  hc: boolean;
  canScore: boolean;
  canMarkHc?: boolean;
  points?: number;
  heatTotal?: number;
  overridePoints?: number;
  card?: RefereeCard;
  onTap: () => void;
  onSwipeEliminate: () => void;
  onToggleElim: () => void;
  onHc?: () => void;
}) {
  const eliminated = state?.eliminated ?? false;
  const placed = Boolean(state?.place && !eliminated);
  const disabled = !canScore || sitting;
  const dragged = useRef(false);
  const held = useRef(false);
  const holdTimer = useRef<number | null>(null);
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
    }, 650);
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
      try {
        if (typeof navigator !== 'undefined' && navigator.vibrate && localStorage.getItem('mg.prefs.scorerHaptics') !== '0') {
          navigator.vibrate(15);
        }
      } catch {
        // Ignore storage or vibration errors.
      }
      onTap();
    }
  }

  const badge = sitting ? (
    <span className="sc-badge sc-badge-sit" aria-label="Sitting out">S</span>
  ) : eliminated ? (
    <span className="sc-score-right">
      <span className="sc-badge sc-badge-out" aria-label={statusLabel(true, state?.status) ?? 'Eliminated'}>
        {statusLetter(true, state?.status) === 'E' ? 'OUT' : statusLetter(true, state?.status)}
      </span>
      <span className="sc-pts sc-pts-out">{formatPoints(points)} pts</span>
    </span>
  ) : state?.place ? (
    <span className="sc-score-right">
      <span className="sc-badge" aria-label={`Place ${state.place}`}>{ordinal(state.place)}</span>
      <span className="sc-pts">
        {hc ? 'No points' : overridePoints != null ? `${formatPoints(points)} pts · manual` : `+${formatPoints(points)} pts`}
      </span>
    </span>
  ) : overridePoints != null ? (
    <span className="sc-score-right">
      <span className="sc-badge">{formatPoints(overridePoints)}</span>
      <span className="sc-pts">{formatPoints(overridePoints)} pts · manual</span>
    </span>
  ) : null;

  const rowStyle = {
    ...(hatband ? hatbandBoxStyle(hatband) : {}),
    ...(eliminated ? { borderColor: '#E8B4BA' } : {}),
  };

  return (
    <li
      className={`sc-row ${placed ? 'sc-row-placed' : ''} ${eliminated ? 'sc-row-out' : ''} ${sitting ? 'sc-row-sit' : ''}`}
      style={rowStyle}
    >
      {holding && <span className="sc-hold" aria-hidden="true" />}
      <motion.button
        type="button"
        className="sc-main-btn"
        disabled={disabled}
        aria-label={`${entry.teamName}, lane ${lane}${hc ? ', hors concours' : ''}`}
        drag={!disabled ? 'y' : false}
        dragSnapToOrigin
        dragElastic={0.4}
        dragConstraints={{ top: 0, bottom: 80 }}
        onPointerDown={handlePointerDown}
        onPointerUp={clearHold}
        onPointerLeave={clearHold}
        onPointerCancel={clearHold}
        onPanStart={clearHold}
        onPanEnd={handlePanEnd}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Delete' || e.key === 'Backspace')) {
            e.preventDefault();
            onToggleElim();
          }
        }}
      >
        <span className="sc-bib-bar" aria-hidden="true" style={{ background: dotColour(entry.bibColour) }} />
        <span className="sc-lane" title={`Lane ${lane}`}>{sitting ? lane : `L${lane}`}</span>
        <span className="sc-who">
          <span className="sc-name-row">
            <span className="sc-name">
              {entry.teamName}
              <TeamCardBadge card={card} />
              {hc && <span className="sc-tag sc-tag-hc">HC</span>}
            </span>
            {overridePoints != null && !hc && <span className="sc-tag sc-tag-manual">Manual</span>}
          </span>
          <span className="sc-meta-row">
            <span className="sc-heat-total">Heat total {formatPoints(heatTotal)}</span>
            <BibSwatch colour={entry.bibColour} />
            <HatbandSwatch colour={hatband} />
          </span>
        </span>
        {badge}
      </motion.button>
    </li>
  );
}

function Overlay({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sc-overlay" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={label} className="sc-sheet" onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

/** Bottom sheet to override a team's score (Automatic, Set points, or Hors concours) and run mid-session race controls. */
export function ScoreOverrideSheet({
  raceName, entries, lanesByTeam, pendingByTeam, pointsFor, overrides, hcTeamIds, onSetHc, onSaveOverride, onClose,
  isRaceComplete, onClearRaceScore, competitionId,
  onAddRace, onRenameRace, onRerunRace, runoffTeams, onPickRunoffWinner,
}: {
  raceName: string;
  entries: HeatEntry[];
  lanesByTeam: Record<number, string>;
  pendingByTeam: ReadonlyMap<number, PendingPlace>;
  pointsFor: (place: number, eliminated: boolean) => number;
  overrides: Readonly<Record<number, ScoreOverrideValue>>;
  hcTeamIds: ReadonlySet<number>;
  onSetHc?: (teamId: number, hc: boolean) => Promise<void> | void;
  onSaveOverride: (teamId: number, value: ScoreOverrideValue | null) => void;
  onClose: () => void;
  isRaceComplete?: boolean;
  onClearRaceScore?: () => Promise<void> | void;
  competitionId?: number;
  onAddRace?: (raceName: string) => Promise<void> | void;
  onRenameRace?: (newName: string) => Promise<void> | void;
  onRerunRace?: () => Promise<void> | void;
  runoffTeams?: Array<{ id: number; name: string }>;
  onPickRunoffWinner?: (teamId: number) => Promise<void> | void;
}) {
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [mode, setMode] = useState<'auto' | 'set' | 'hc'>('auto');
  const [pts, setPts] = useState<number>(0);
  const [reason, setReason] = useState<string>('');
  const [card, setCard] = useState<RefereeCard>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmHc, setConfirmHc] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const mounted = useRef(true);
  const currentEntries = useRef(entries);
  useEffect(() => { currentEntries.current = entries; }, [entries]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [clearing, setClearing] = useState(false);
  const [cardsEnabled] = useCardsEnabled(competitionId);
  const [runoffTeamId, setRunoffTeamId] = useState<number | null>(runoffTeams?.[0]?.id ?? null);

  const selectedEntry = entries.find((e) => e.teamId === selectedTeamId) ?? null;

  function autoStatus(teamId: number): string {
    const st = pendingByTeam.get(teamId);
    if (st?.eliminated) return 'Eliminated · 0 pts';
    if (st?.place) return `${ordinal(st.place)} · ${formatPoints(pointsFor(st.place, false))} pts`;
    return 'Not placed yet';
  }

  function pickTeam(entry: HeatEntry) {
    const isHc = hcTeamIds.has(entry.teamId);
    const ov = overrides[entry.teamId];
    const st = pendingByTeam.get(entry.teamId);
    const defaultPts = ov ? ov.points : st?.place && !st.eliminated ? pointsFor(st.place, false) : 0;
    const note = ov?.reason ?? st?.refereeNote ?? '';
    const parsed = parseRefereeCard(note);
    const storedCards = getStoredCards(competitionId);
    const effectiveCard = cardsEnabled ? (parsed.card ?? storedCards[entry.teamId] ?? null) : null;

    setSelectedTeamId(entry.teamId);
    setMode(isHc ? 'hc' : ov ? 'set' : 'auto');
    setPts(defaultPts);
    setCard(effectiveCard);
    setReason(parsed.cleanNote);
  }

  function saveTeam() {
    if (!selectedEntry || saving) return;
    if (onSetHc && (mode === 'hc') !== hcTeamIds.has(selectedEntry.teamId)) {
      setConfirmHc(true);
      return;
    }
    void applyTeam();
  }

  async function applyTeam() {
    if (!selectedEntry || saving) return;
    const teamId = selectedEntry.teamId;
    setSaving(true);
    setSaveError(null);
    try {
      if (onSetHc && (mode === 'hc') !== hcTeamIds.has(teamId)) await onSetHc(teamId, mode === 'hc');
      if (!mounted.current || !currentEntries.current.some((entry) => entry.teamId === teamId)) return;
      if (cardsEnabled) setStoredCard(competitionId, teamId, card);
      const finalReason = cardsEnabled ? formatRefereeCardNote(card, reason) : reason.trim();
      onSaveOverride(teamId, mode === 'set' ? { points: pts, reason: finalReason || undefined } : null);
      setSelectedTeamId(null);
      setConfirmHc(false);
    } catch {
      if (mounted.current) setSaveError('Couldn’t save this change. Please try again.');
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <Overlay label="Score override" onClose={saving ? () => {} : onClose}>
      {saveError && <p role="alert">{saveError}</p>}
      {confirmHc && selectedEntry && <HcConfirm teamName={selectedEntry.teamName} isHc={hcTeamIds.has(selectedEntry.teamId)} busy={saving} onConfirm={() => void applyTeam()} onCancel={() => { if (!saving) setConfirmHc(false); }} />}
      {!selectedEntry ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="sc-title">Score override</h3>
              <p className="sc-sub">{raceName} · pick a team</p>
            </div>
            <button type="button" className="sc-tool-btn" aria-label="Close" onClick={onClose}>
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="flex flex-col gap-1.5">
            {entries.map((e) => {
              const isHc = hcTeamIds.has(e.teamId);
              const ov = overrides[e.teamId];
              const st = pendingByTeam.get(e.teamId);
              const teamCard = cardsEnabled
                ? (parseRefereeCard(ov?.reason ?? st?.refereeNote).card ?? getStoredCards(competitionId)[e.teamId] ?? null)
                : null;
              const statusText = isHc ? 'HC' : ov ? `${formatPoints(ov.points)} pts · manual` : autoStatus(e.teamId);
              return (
                <button key={e.id} type="button" className="sc-ov-team-btn" onClick={() => pickTeam(e)}>
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: dotColour(e.bibColour) }} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate font-bold">
                    {e.teamName}
                    <TeamCardBadge card={teamCard} />
                  </span>
                  <span className="text-sm font-semibold text-[rgb(var(--mg-muted))]">{statusText}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[rgb(var(--mg-muted))]" aria-hidden="true" />
                </button>
              );
            })}
          </div>
          {onClearRaceScore && isRaceComplete && (
            <div className="border-t border-[rgb(var(--mg-rule-soft))] pt-3">
              {!confirmClear ? (
                <button
                  type="button"
                  className="mg-btn mg-btn-secondary w-full text-red-700"
                  onClick={() => setConfirmClear(true)}
                >
                  Clear race score
                </button>
              ) : (
                <div className="space-y-2 rounded-lg border border-red-300 bg-red-50/70 p-2.5">
                  <p className="text-xs font-semibold text-red-900">
                    Reset all placings and points for {raceName}?
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="mg-btn mg-btn-danger flex-1"
                      disabled={clearing}
                      onClick={async () => {
                        setClearing(true);
                        try {
                          await onClearRaceScore();
                        } finally {
                          setClearing(false);
                          setConfirmClear(false);
                        }
                      }}
                    >
                      {clearing ? 'Clearing…' : 'Confirm clear score'}
                    </button>
                    <button
                      type="button"
                      className="mg-btn mg-btn-secondary"
                      disabled={clearing}
                      onClick={() => setConfirmClear(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {(onRenameRace || onAddRace || onRerunRace || (onPickRunoffWinner && runoffTeams && runoffTeams.length > 0)) && (
            <div className="space-y-3 border-t border-[rgb(var(--mg-rule-soft))] pt-3">
              <span className="text-xs font-bold uppercase tracking-wider text-[rgb(var(--mg-muted))]">Race controls</span>
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
                <button
                  type="button"
                  className="mg-btn mg-btn-secondary !min-h-10 w-full !text-xs"
                  onClick={() => { void onRerunRace(); }}
                >
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
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <button type="button" className="sc-tool-btn" aria-label="Back to teams" onClick={() => setSelectedTeamId(null)}>
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <div className="min-w-0 flex-1">
              <h3 className="sc-title">
                {selectedEntry.teamName}
                {cardsEnabled && <TeamCardBadge card={card} />}
              </h3>
              <p className="sc-sub">Lane {lanesByTeam[selectedEntry.teamId] ?? selectedEntry.laneIndex} · {autoStatus(selectedEntry.teamId)}</p>
            </div>
          </div>

          {cardsEnabled && (
            <div className="space-y-1.5" role="group" aria-label="Referee card">
              <span className="text-xs font-semibold uppercase tracking-wider text-[rgb(var(--mg-muted))]">
                Referee card
              </span>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  className={`mg-btn text-xs !py-1 !px-2.5 ${card === null ? 'mg-btn-primary' : 'mg-btn-secondary'}`}
                  onClick={() => setCard(null)}
                >
                  No card
                </button>
                <button
                  type="button"
                  className={`mg-btn text-xs !py-1 !px-2.5 ${card === 'yellow' ? 'border-amber-500 bg-amber-400 font-bold text-amber-950 shadow-xs' : 'mg-btn-secondary'}`}
                  onClick={() => setCard('yellow')}
                >
                  🟨 Yellow card
                </button>
                <button
                  type="button"
                  className={`mg-btn text-xs !py-1 !px-2.5 ${card === 'red' ? 'border-red-600 bg-red-600 font-bold text-white shadow-xs' : 'mg-btn-secondary'}`}
                  onClick={() => setCard('red')}
                >
                  🟥 Red card
                </button>
              </div>
            </div>
          )}

          <div role="radiogroup" aria-label="How this team scores" className="flex flex-col gap-2">
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'auto'}
              className="sc-ov-radio"
              onClick={() => setMode('auto')}
            >
              <span className="flex flex-col">
                <span className="font-bold">Automatic</span>
                <span className="sc-sub">Points from finishing place ({autoStatus(selectedEntry.teamId)})</span>
              </span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'set'}
              className="sc-ov-radio"
              onClick={() => setMode('set')}
            >
              <span className="flex flex-col">
                <span className="font-bold">Set points</span>
                <span className="sc-sub">Enter this race’s points by hand</span>
              </span>
            </button>
            {onSetHc && (
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'hc'}
                className="sc-ov-radio"
                onClick={() => setMode('hc')}
              >
                <span className="flex flex-col">
                  <span className="font-bold">Hors concours (HC)</span>
                  <span className="sc-sub">Rides, but scores no points</span>
                </span>
              </button>
            )}
          </div>

          {mode === 'set' && (() => {
            const st = pendingByTeam.get(selectedEntry.teamId);
            const basePlace = st?.place && !st.eliminated ? st.place : 1;
            const splitPts = (pointsFor(basePlace, false) + pointsFor(basePlace + 1, false)) / 2;
            return (
              <div className="space-y-2">
                <div className="sc-ov-stepper">
                  <span className="font-semibold">Points this race</span>
                  <span className="flex items-center gap-2">
                    <button type="button" className="sc-ov-step-btn" aria-label="Half a point fewer" onClick={() => setPts((p) => Math.max(0, p - 0.5))}>−</button>
                    <span aria-live="polite" className="min-w-10 text-center font-[var(--mg-font-display)] text-2xl font-bold text-[rgb(var(--mg-heading))]">{formatPoints(pts)}</span>
                    <button type="button" className="sc-ov-step-btn" aria-label="Half a point more" onClick={() => setPts((p) => Math.min(30, p + 0.5))}>+</button>
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className="sc-mini"
                    onClick={() => {
                      setPts(splitPts);
                      if (!reason.trim()) setReason('Dead heat');
                    }}
                  >
                    Split dead heat ({formatPoints(splitPts)} pts)
                  </button>
                </div>
              </div>
            );
          })()}

          {mode !== 'auto' && (
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Reason
              <input
                type="text"
                className="input min-h-11"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Judge’s decision"
              />
            </label>
          )}

          <div className="sc-actions">
            <button type="button" className="mg-btn mg-btn-primary sc-submit-btn" onClick={() => void saveTeam()}>
              {mode === 'auto' ? (overrides[selectedEntry.teamId] ? 'Remove override' : 'Done') : 'Save override'}
            </button>
          </div>
        </div>
      )}
    </Overlay>
  );
}

/** Asks before a team is made hors concours or brought back. Says what it means. */
export function HcConfirm({ teamName, isHc, busy, onConfirm, onCancel }: { teamName: string; isHc: boolean; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Overlay label="Hors concours" onClose={onCancel}>
      <h3 className="sc-title">{isHc ? `Bring ${teamName} back into scoring?` : `Make ${teamName} hors concours?`}</h3>
      <p className="mg-body mt-2">
        {isHc
          ? 'It will score again and count in standings and finals seeding.'
          : 'Competes but doesn’t score; removed from standings and finals seeding.'}
      </p>
      <div className="sc-actions">
        <button type="button" className="mg-btn mg-btn-primary" disabled={busy} onClick={onConfirm}>{isHc ? 'Bring back' : 'Make HC'}</button>
        <button type="button" className="mg-btn mg-btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </Overlay>
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
          <span className="sc-name">{names[p.teamId] ?? `Team ${p.teamId}`}</span>
          <div className="sc-choices" role="group" aria-label={`Reason for ${names[p.teamId] ?? p.teamId}`}>
            {ELIM_REASONS.map((r) => (
              <button key={r.key} type="button" className="sc-choice" aria-pressed={choice[p.teamId]?.key === r.key}
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

/** The current race's lanes, in order. Sits beside the races on a wide screen and after them on a phone. */
export function LaneView({ heat, raceIndex, raceName, rules, hatbands }: { heat: Heat; raceIndex: number; raceName: string; rules: LaneRules; hatbands?: string[] | null }) {
  if (heat.entries.length === 0) return null;
  const rotated = raceIndex > 0 && rules.mode !== 1;
  return (
    <section className="sc-card sc-pad" aria-label="Lane view">
      <h3 className="sc-label">Lanes for {raceName}</h3>
      {rotated && <p className="sc-sub">Rotated {rules.mode === 2 ? '-' : '+'}{raceIndex} from the draw</p>}
      <ol className="sc-rows mt-1">
        {inLaneOrder(heat, raceIndex, rules).map((e) => (
          <li key={e.id} className="sc-lane-item">
            <span className="sc-lane">{displayLaneFor(heat, e, raceIndex, rules)}</span>
            <span className="sc-who"><span className="sc-name">{e.teamName}</span><BibSwatch colour={e.bibColour} /><HatbandSwatch colour={hatbandFor(hatbands, displayLaneFor(heat, e, raceIndex, rules))} /></span>
          </li>
        ))}
      </ol>
    </section>
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
      {lanes.note && <p className={lanes.provisional ? 'mg-notice mt-2' : 'sc-sub'}>{lanes.note}</p>}
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

/** The race rules, one button per race, below the table when opened. */
export function RaceRules({ races }: { races: Race[] }) {
  const [open, setOpen] = useState(false);
  if (races.length === 0) return null;
  return (
    <>
      <div className="flex justify-center">
        <button
          type="button"
          className="mg-text-link"
          aria-expanded={open}
          onClick={() => setOpen((show) => !show)}
        >
          {open ? 'Close race rules and setup' : 'Race rules and arena setup'}
        </button>
      </div>
      {open && (
        <section aria-label="Race rules" className="sc-card px-3">
          <h3 className="sc-label pt-3">Race rules</h3>
          <ol className="divide-y divide-[rgb(var(--mg-rule-soft))]">
            {races.map((r) => (
              <li key={r.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate py-2">{r.name}</span>
                <RaceRulesButton raceName={r.name} className="!h-11 !w-11" />
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
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

  return (
    <div className="space-y-2.5" role="alert" aria-label="Score clash">
      {clashes.map((clash) => {
        const busy = busyRaceId === clash.raceId;
        const sideA = sortClashPlaces(clash.existingPlaces);
        const sideB = sortClashPlaces(clash.incomingPlaces);
        return (
          <section
            key={clash.raceId}
            className="rounded-xl border-2 border-amber-500 bg-amber-50/95 p-3 text-amber-950 shadow-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold">
                Score clash · {clash.raceOrder ? `Race ${clash.raceOrder}: ` : ''}{clash.raceName}
              </h3>
              <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-900">
                Choose result
              </span>
            </div>
            <p className="mt-0.5 text-xs text-amber-900">
              Two scorers submitted different placings. Tap the right result to apply it.
            </p>
            <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="flex flex-col justify-between rounded-lg border border-amber-300 bg-white p-2.5">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-stone-600">
                    Result A (Saved)
                  </div>
                  <ol className="mt-1.5 space-y-1 text-xs">
                    {sideA.map((p) => (
                      <li key={p.teamId} className="flex items-center justify-between gap-2">
                        <span className="truncate font-semibold text-stone-900">
                          {teamNamesById[p.teamId] ?? `Team ${p.teamId}`}
                        </span>
                        <span className="shrink-0 font-bold text-stone-700">{formatClashPlace(p)}</span>
                      </li>
                    ))}
                  </ol>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handlePick(clash, false)}
                  className="mg-btn mg-btn-secondary mt-2.5 min-h-10 w-full text-xs font-bold"
                >
                  Keep Result A
                </button>
              </div>
              <div className="flex flex-col justify-between rounded-lg border border-amber-400 bg-white p-2.5">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-amber-800">
                    Result B (Submitted)
                  </div>
                  <ol className="mt-1.5 space-y-1 text-xs">
                    {sideB.map((p) => (
                      <li key={p.teamId} className="flex items-center justify-between gap-2">
                        <span className="truncate font-semibold text-stone-900">
                          {teamNamesById[p.teamId] ?? `Team ${p.teamId}`}
                        </span>
                        <span className="shrink-0 font-bold text-amber-900">{formatClashPlace(p)}</span>
                      </li>
                    ))}
                  </ol>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handlePick(clash, true)}
                  className="mg-btn mg-btn-primary mt-2.5 min-h-10 w-full text-xs font-bold"
                >
                  Use Result B
                </button>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
