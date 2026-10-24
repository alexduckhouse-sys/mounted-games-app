import { motion, type PanInfo } from 'framer-motion';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BibSwatch, HatbandSwatch } from '../../components/BibSwatch';
import { dotColour, teamBoxStyle } from '../../lib/teamColours';
import { RaceRulesButton } from '../../components/RaceRulesButton';
import { ELIM_REASONS, OTHER_REASON, noteFor, reasonKeyOf, statusFor } from '../../lib/elimReasons';
import { hatbandFor, inLaneOrder } from '../../lib/laneOrder';
import type { NextLanes } from '../../lib/nextRoundLanes';
import type { PendingPlace } from '../../lib/raceScoring';
import type { RaceSummary } from '../../lib/raceSummary';
import { statusLetter, statusLabel } from '../../lib/resultStatus';
import { ordinal } from '../../lib/toplist';
import type { Heat, HeatEntry, Race } from '../../types';
import { displayLaneFor, type LaneRules } from './laneRules';
import './heat.css';
import './scoring.css';
import { formatPoints } from '../../lib/formatPoints';

export interface ScoreOverrideValue {
  points: number;
  reason?: string;
}

/** One team in the race being scored. A tap places it, a hold or swipe down eliminates it; the Out and HC buttons are for everyone who can't swipe. */
export function ScoreRow({
  entry, lane, hatband, state, sitting, hc, canScore, canMarkHc, points = 0, heatTotal = 0, overridePoints,
  onTap, onSwipeEliminate, onToggleElim, onHc,
}: {
  entry: HeatEntry;
  lane: string;
  hatband?: string | null;
  state?: PendingPlace;
  sitting: boolean;
  hc: boolean;
  canScore: boolean;
  canMarkHc: boolean;
  points?: number;
  heatTotal?: number;
  overridePoints?: number;
  onTap: () => void;
  onSwipeEliminate: () => void;
  onToggleElim: () => void;
  onHc: () => void;
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
    if (!disabled && info.offset.y > 50 && info.velocity.y > 0) onSwipeEliminate();
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
    if (!disabled) onTap();
  }

  const badge = sitting ? (
    <span className="sc-badge sc-badge-sit" aria-label="Sitting out">S</span>
  ) : eliminated ? (
    <span className="sc-score-right">
      <span className="sc-badge sc-badge-out" aria-label={statusLabel(true, state?.status) ?? 'Eliminated'}>
        {statusLetter(true, state?.status) === 'E' ? 'OUT' : statusLetter(true, state?.status)}
      </span>
      <span className="sc-pts sc-pts-out">0 pts</span>
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
    ...teamBoxStyle(entry.bibColour),
    ...(eliminated ? { borderColor: '#E8B4BA' } : entry.bibColour ? { borderColor: dotColour(entry.bibColour) } : {}),
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
            <span className="sc-name">{entry.teamName} {hc && <span className="sc-tag sc-tag-hc">HC</span>}</span>
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
      {canScore && !sitting && (
        <button type="button" className="sc-mini" aria-pressed={eliminated} aria-label={eliminated ? `Bring ${entry.teamName} back in` : `Eliminate ${entry.teamName}`} onClick={onToggleElim}>
          {eliminated ? 'Back in' : 'Out'}
        </button>
      )}
      {canMarkHc && (
        <button type="button" className="sc-mini" aria-pressed={hc} aria-label={hc ? `Bring ${entry.teamName} back into scoring` : `Mark ${entry.teamName} hors concours`} onClick={onHc}>
          HC
        </button>
      )}
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

/** Bottom sheet to override a team's score (Automatic, Set points, or Hors concours). */
export function ScoreOverrideSheet({
  raceName, entries, lanesByTeam, pendingByTeam, pointsFor, overrides, hcTeamIds, onSetHc, onSaveOverride, onClose,
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
}) {
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [mode, setMode] = useState<'auto' | 'set' | 'hc'>('auto');
  const [pts, setPts] = useState<number>(0);
  const [reason, setReason] = useState<string>('');

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
    setSelectedTeamId(entry.teamId);
    setMode(isHc ? 'hc' : ov ? 'set' : 'auto');
    setPts(defaultPts);
    setReason(ov?.reason ?? '');
  }

  async function saveTeam() {
    if (!selectedEntry) return;
    const teamId = selectedEntry.teamId;
    const wasHc = hcTeamIds.has(teamId);
    if (mode === 'hc') {
      onSaveOverride(teamId, null);
      if (onSetHc && !wasHc) await onSetHc(teamId, true);
    } else if (mode === 'set') {
      if (onSetHc && wasHc) await onSetHc(teamId, false);
      onSaveOverride(teamId, { points: pts, reason: reason.trim() || undefined });
    } else {
      if (onSetHc && wasHc) await onSetHc(teamId, false);
      onSaveOverride(teamId, null);
    }
    setSelectedTeamId(null);
  }

  return (
    <Overlay label="Score override" onClose={onClose}>
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
              const statusText = isHc ? 'HC' : ov ? `${formatPoints(ov.points)} pts · manual` : autoStatus(e.teamId);
              return (
                <button key={e.id} type="button" className="sc-ov-team-btn" onClick={() => pickTeam(e)}>
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: dotColour(e.bibColour) }} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate font-bold">{e.teamName}</span>
                  <span className="text-sm font-semibold text-[rgb(var(--mg-muted))]">{statusText}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[rgb(var(--mg-muted))]" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <button type="button" className="sc-tool-btn" aria-label="Back to teams" onClick={() => setSelectedTeamId(null)}>
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <div className="min-w-0 flex-1">
              <h3 className="sc-title">{selectedEntry.teamName}</h3>
              <p className="sc-sub">Lane {lanesByTeam[selectedEntry.teamId] ?? selectedEntry.laneIndex} · {autoStatus(selectedEntry.teamId)}</p>
            </div>
          </div>

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

          {mode === 'set' && (
            <div className="sc-ov-stepper">
              <span className="font-semibold">Points this race</span>
              <span className="flex items-center gap-2">
                <button type="button" className="sc-ov-step-btn" aria-label="One point fewer" onClick={() => setPts((p) => Math.max(0, p - 1))}>−</button>
                <span aria-live="polite" className="min-w-10 text-center font-[var(--mg-font-display)] text-2xl font-bold text-[rgb(var(--mg-heading))]">{formatPoints(pts)}</span>
                <button type="button" className="sc-ov-step-btn" aria-label="One point more" onClick={() => setPts((p) => Math.min(30, p + 1))}>+</button>
              </span>
            </div>
          )}

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
export function HeatGrid({ heat, races, activeRaceId, activeIndex, rules, pending, pointsFor, hcTeamIds }: {
  heat: Heat;
  races: Race[];
  activeRaceId: number | null;
  activeIndex: number;
  rules: LaneRules;
  pending: PendingPlace[];
  pointsFor: (place: number, eliminated: boolean) => number;
  hcTeamIds: ReadonlySet<number>;
}) {
  const teams = inLaneOrder(heat, activeIndex, rules);
  const minWidth = 12 + 116 + races.length * 23 + 44;

  function cellFor(race: Race, teamId: number): ReactNode {
    if (race.id === activeRaceId) {
      const p = pending.find((x) => x.teamId === teamId);
      if (p) return p.eliminated
        ? <span className="heat-elim">{statusLetter(true, p.status) ?? 'E'}</span>
        : <>{p.place} ({pointsFor(p.place, false)})</>;
    }
    const r = race.results.find((x) => x.teamId === teamId);
    if (!r) return <span className="heat-dash">–</span>;
    if (r.isSitOut) return <span className="heat-dash">S</span>;
    if (r.eliminated) return <span className="heat-elim">{statusLetter(true, r.status)}</span>;
    return <>{formatPoints(r.points)}</>;
  }

  return (
    <section aria-label="Heat table" className="sc-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="heat-grid" style={{ minWidth }}>
          <thead>
            <tr>
              <th scope="col" className="heat-team-head"><span>Team</span></th>
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
              const total = races.reduce((sum, r) => sum + (r.results.find((x) => x.teamId === t.teamId)?.points ?? 0), 0);
              return (
                <tr key={t.teamId}>
                  <th scope="row" className="heat-team" title={t.teamName}>{t.teamName}{hcTeamIds.has(t.teamId) ? ' (HC)' : ''}</th>
                  {races.map((r, i) => <td key={r.id} className={`heat-cell ${i === 0 ? 'heat-cell-first' : ''}`}>{cellFor(r, t.teamId)}</td>)}
                  <td className="heat-total">{total}</td>
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
