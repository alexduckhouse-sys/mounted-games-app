import { useState } from 'react';
import { ChevronRight, MoreHorizontal } from 'lucide-react';
import { formatPoints } from '../../lib/formatPoints';
import { redLabel, yellowLabel, type CardMark } from '../../lib/refereeCards';
import { CardChip, LaneBand } from './ScoringParts';

/** One team in the race tools list. */
export interface ToolTeam {
  teamId: number;
  name: string;
  hatband?: string | null;
  bib?: string | null;
  points: number;
  /** Points moved by hand in this race, shown as "+1 by hand". */
  byHand?: number;
  card: CardMark;
  hc: boolean;
  /** Out of this race (E, DNS...). Shown in the menu as "Undo elimination". */
  eliminated?: boolean;
  /** Sitting this race out, so it can't be eliminated or tied. */
  sitting?: boolean;
  /** Marked as having tied for its place. */
  deadHeat?: boolean;
}

/** A row below the teams that opens another screen. */
export interface ToolLink { key: string; label: string; sub: string; onSelect: () => void }

interface RaceToolsSheetProps {
  teams: ToolTeam[];
  /** HC changes the team for the whole event, so it is for organisers only. */
  canHc: boolean;
  /** Cards are set by staff; a scorer link can't give them. */
  canCards: boolean;
  /** Points can't be changed on a race that is saved and locked. */
  canChangePoints: boolean;
  onHc: (teamId: number) => void;
  onYellow: (teamId: number) => void;
  onRed: (teamId: number) => void;
  /** Move the team's points for this race up or down by one. */
  onStepPoints: (teamId: number, by: 1 | -1) => void;
  /** Eliminate the team, or bring it back: the same as pressing and holding its lane card. Without it there is no menu item. */
  onEliminate?: (teamId: number) => void;
  /** Mark these teams as having tied for a place. Without it there is no Dead heat switch. */
  onDeadHeat?: (teamIds: number[]) => void;
  /** Split a dead heat that the team is part of. */
  onClearDeadHeat?: (teamId: number) => void;
  /** When given, the commentator facts switch shows. */
  factsOn?: boolean;
  onToggleFacts?: () => void;
  links: ToolLink[];
  onClose: () => void;
}

/** The ⋯ sheet on the scoring screen: every team with its own menu (HC, cards, points), then the other tools. */
export function RaceToolsSheet({
  teams, canHc, canCards, canChangePoints, onHc, onYellow, onRed, onStepPoints, onEliminate, onDeadHeat, onClearDeadHeat, factsOn, onToggleFacts, links, onClose,
}: RaceToolsSheetProps) {
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [tieMode, setTieMode] = useState(false);
  const [ticked, setTicked] = useState<number[]>([]);

  function pick(action: () => void) {
    setMenuFor(null);
    action();
  }

  function toggleTick(teamId: number) {
    setTicked((cur) => (cur.includes(teamId) ? cur.filter((id) => id !== teamId) : [...cur, teamId]));
  }

  function applyTie() {
    if (ticked.length < 2) return;
    onDeadHeat?.(ticked);
    setTicked([]);
    setTieMode(false);
  }

  return (
    <div className="rt-overlay">
      <button type="button" className="rt-scrim" aria-label="Close race tools" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Race tools" className="rt-sheet">
        <div className="rt-head">
          <span className="rt-title">Race tools</span>
          <button type="button" className="sc-link" onClick={onClose}>Close</button>
        </div>
        <div className="rt-teams" role="group" aria-label="Teams in this race">
          {teams.map((t) => {
            const open = menuFor === t.teamId;
            const stepping = editing === t.teamId;
            return (
              <div className="rt-row" key={t.teamId}>
                <LaneBand hatband={t.hatband} bib={t.bib} />
                <span className="rt-who">
                  <span className="rt-name">{t.name}<CardChip card={t.card} hc={t.hc} /></span>
                  {t.deadHeat ? <span className="rt-note">Dead heat</span> : null}
                  {t.byHand ? <span className="rt-note">{t.byHand > 0 ? '+' : ''}{formatPoints(t.byHand)} by hand</span> : null}
                </span>
                {tieMode && (
                  <label className="rt-tick">
                    <input type="checkbox" checked={ticked.includes(t.teamId)} disabled={t.sitting} onChange={() => toggleTick(t.teamId)} />
                    <span className="sr-only">{`Tied: ${t.name}`}</span>
                  </label>
                )}
                {!stepping && !tieMode && <span className="rt-pts" aria-label={`${formatPoints(t.points)} ${t.points === 1 ? 'point' : 'points'}`}>{formatPoints(t.points)}</span>}
                <span className="rt-more">
                  <button
                    type="button"
                    className="rt-dots"
                    aria-haspopup="menu"
                    aria-expanded={open}
                    aria-label={`More for ${t.name}`}
                    onClick={() => setMenuFor(open ? null : t.teamId)}
                  >
                    <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
                  </button>
                  {open && (
                    <span className="rt-menu" role="menu" aria-label={t.name}>
                      {canHc && <button type="button" role="menuitem" onClick={() => pick(() => onHc(t.teamId))}>{t.hc ? 'Remove HC' : 'Make HC'}</button>}
                      {canCards && (
                        <>
                          <button type="button" role="menuitem" onClick={() => pick(() => onYellow(t.teamId))}>
                            <span className="rt-sw rt-sw-yellow" aria-hidden="true" />{yellowLabel(t.card)}
                          </button>
                          <button type="button" role="menuitem" onClick={() => pick(() => onRed(t.teamId))}>
                            <span className="rt-sw rt-sw-red" aria-hidden="true" />{redLabel(t.card)}
                          </button>
                        </>
                      )}
                      {onEliminate && !t.sitting && (
                        <button type="button" role="menuitem" onClick={() => pick(() => onEliminate(t.teamId))}>{t.eliminated ? 'Undo elimination' : 'Eliminate (E)'}</button>
                      )}
                      {t.deadHeat && onClearDeadHeat && (
                        <button type="button" role="menuitem" onClick={() => pick(() => onClearDeadHeat(t.teamId))}>Split dead heat</button>
                      )}
                      {canChangePoints && (
                        <button type="button" role="menuitem" onClick={() => { setMenuFor(null); setEditing(t.teamId); }}>Change points</button>
                      )}
                    </span>
                  )}
                </span>
                {stepping && (
                  <span className="rt-edit">
                    <span className="rt-step">
                      <button type="button" aria-label={`One point fewer for ${t.name}`} disabled={t.points <= 0} onClick={() => onStepPoints(t.teamId, -1)}>−</button>
                      <span className="rt-step-n" aria-live="polite">{formatPoints(t.points)}</span>
                      <button type="button" aria-label={`One more point for ${t.name}`} onClick={() => onStepPoints(t.teamId, 1)}>+</button>
                    </span>
                    <button type="button" className="mg-btn mg-btn-secondary" onClick={() => setEditing(null)}>Done</button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {tieMode && (
          <div className="rt-tie-bar" role="group" aria-label="Dead heat">
            <span className="rt-tie-count" aria-live="polite">{ticked.length === 0 ? 'Tick the teams that tied' : `${ticked.length} ticked`}</span>
            <button type="button" className="kit-pill kit-pill-fill" disabled={ticked.length < 2} onClick={applyTie}>Mark dead heat</button>
          </div>
        )}
        <div className="rt-links">
          {onDeadHeat && (
            <label className="rt-link">
              <span className="rt-link-text"><span className="rt-link-name">Dead heat</span><span className="rt-link-sub">Teams that finish together share the points</span></span>
              <input type="checkbox" role="switch" checked={tieMode} onChange={() => { setTieMode((on) => !on); setTicked([]); }} />
            </label>
          )}
          {onToggleFacts && (
            <label className="rt-link">
              <span className="rt-link-text"><span className="rt-link-name">Commentator facts</span></span>
              <input type="checkbox" role="switch" checked={Boolean(factsOn)} onChange={onToggleFacts} />
            </label>
          )}
          {links.map((l) => (
            <button type="button" className="rt-link" key={l.key} onClick={l.onSelect}>
              <span className="rt-link-text"><span className="rt-link-name">{l.label}</span><span className="rt-link-sub">{l.sub}</span></span>
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
          ))}
        </div>
        <section className="rt-keys" aria-labelledby="rt-keys-title">
          <h3 id="rt-keys-title" className="rt-keys-title">Using a keypad</h3>
          <p className="rt-link-sub">Pair a Bluetooth keypad, page-turner or foot pedal with your phone, then:</p>
          <dl className="rt-keys-list">
            {KEY_GUIDE.map(([keys, does]) => (
              <div key={keys} className="contents"><dt>{keys}</dt><dd>{does}</dd></div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}

/** The keys from lib/scoringKeys.ts, in words. */
const KEY_GUIDE: Array<[string, string]> = [
  ['1 to 9', 'That lane is next over the line'],
  ['. or - then the lane', 'Eliminate that lane'],
  ['Enter', 'Save scores'],
  ['Backspace, Z, ← or Page Up', 'Undo'],
  ['→ or Page Down', 'Save, or go to the next race once saved'],
];
