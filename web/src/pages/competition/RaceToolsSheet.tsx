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
  eliminated?: boolean;
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
  /** Explicitly toggle Eliminated (E) on a team without the 600ms hold. */
  onToggleElim?: (teamId: number) => void;
  /** Assign a dead-heat tie (same place and split points) to the chosen teams. */
  onDeadHeat?: (teamIds: number[], place: number) => void;
  /** When given, the commentator facts switch shows. */
  factsOn?: boolean;
  onToggleFacts?: () => void;
  links: ToolLink[];
  onClose: () => void;
}

/** The ⋯ sheet on the scoring screen: every team with its own menu (HC, cards, points), then the other tools. */
export function RaceToolsSheet({
  teams, canHc, canCards, canChangePoints, onHc, onYellow, onRed, onStepPoints, onToggleElim, onDeadHeat, factsOn, onToggleFacts, links, onClose,
}: RaceToolsSheetProps) {
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [toolMode, setToolMode] = useState<'eliminate' | 'tie' | null>(null);
  const [tiePlace, setTiePlace] = useState<number>(1);
  const [tiedTeamIds, setTiedTeamIds] = useState<number[]>([]);

  function pick(action: () => void) {
    setMenuFor(null);
    action();
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
                  {t.byHand ? <span className="rt-note">{t.byHand > 0 ? '+' : ''}{formatPoints(t.byHand)} by hand</span> : null}
                </span>
                {!stepping && <span className="rt-pts" aria-label={`${formatPoints(t.points)} ${t.points === 1 ? 'point' : 'points'}`}>{formatPoints(t.points)}</span>}
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
                      {canChangePoints && (
                        <button type="button" role="menuitem" onClick={() => { setMenuFor(null); setEditing(t.teamId); }}>Change points</button>
                      )}
                      {canChangePoints && onToggleElim && (
                        <button type="button" role="menuitem" onClick={() => pick(() => onToggleElim(t.teamId))}>
                          {t.eliminated ? 'Restore from Eliminated (E)' : 'Eliminate (E)'}
                        </button>
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
        <div className="rt-links">
          {canChangePoints && onToggleElim && (
            <div className="space-y-2">
              <button
                type="button"
                className="rt-link"
                aria-expanded={toolMode === 'eliminate'}
                onClick={() => setToolMode(toolMode === 'eliminate' ? null : 'eliminate')}
              >
                <span className="rt-link-text">
                  <span className="rt-link-name">Eliminate (E)</span>
                  <span className="rt-link-sub">Mark a lane or team Eliminated without holding</span>
                </span>
                <ChevronRight className="h-5 w-5" aria-hidden="true" />
              </button>
              {toolMode === 'eliminate' && (
                <div className="flex flex-wrap gap-1.5 px-3 pb-2" role="group" aria-label="Pick team to eliminate">
                  {teams.map((t) => (
                    <button
                      key={t.teamId}
                      type="button"
                      aria-pressed={Boolean(t.eliminated)}
                      onClick={() => onToggleElim(t.teamId)}
                      className={`mg-btn !min-h-9 !px-2.5 text-xs font-semibold ${t.eliminated ? 'mg-btn-primary' : 'mg-btn-secondary'}`}
                    >
                      {t.name}{t.eliminated ? ' (E)' : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {canChangePoints && onDeadHeat && (
            <div className="space-y-2">
              <button
                type="button"
                className="rt-link"
                aria-expanded={toolMode === 'tie'}
                onClick={() => setToolMode(toolMode === 'tie' ? null : 'tie')}
              >
                <span className="rt-link-text">
                  <span className="rt-link-name">Dead-heat / Tie</span>
                  <span className="rt-link-sub">Assign identical placing and split points to tied lanes</span>
                </span>
                <ChevronRight className="h-5 w-5" aria-hidden="true" />
              </button>
              {toolMode === 'tie' && (
                <div className="space-y-2 px-3 pb-2" role="group" aria-label="Dead-heat tie helper">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="font-semibold">Tied place:</span>
                    {teams.map((_, idx) => {
                      const place = idx + 1;
                      return (
                        <button
                          key={place}
                          type="button"
                          aria-pressed={tiePlace === place}
                          onClick={() => setTiePlace(place)}
                          className={`mg-btn !min-h-8 !px-2.5 text-xs font-semibold ${tiePlace === place ? 'mg-btn-primary' : 'mg-btn-secondary'}`}
                        >
                          Place {place}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="font-semibold">Tied teams:</span>
                    {teams.map((t) => {
                      const selected = tiedTeamIds.includes(t.teamId);
                      return (
                        <button
                          key={t.teamId}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setTiedTeamIds((cur) => (selected ? cur.filter((id) => id !== t.teamId) : [...cur, t.teamId]))}
                          className={`mg-btn !min-h-8 !px-2.5 text-xs font-semibold ${selected ? 'mg-btn-primary' : 'mg-btn-secondary'}`}
                        >
                          {t.name}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    disabled={tiedTeamIds.length < 2}
                    onClick={() => {
                      onDeadHeat(tiedTeamIds, tiePlace);
                      setTiedTeamIds([]);
                      setToolMode(null);
                    }}
                    className="mg-btn mg-btn-primary !min-h-9 !px-3 text-xs font-semibold"
                  >
                    Apply dead-heat tie
                  </button>
                </div>
              )}
            </div>
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
        <p className="sc-sub px-4 py-2 text-xs">Tip: Hold any lane tile for 0.6s to mark Eliminated</p>
      </div>
    </div>
  );
}
