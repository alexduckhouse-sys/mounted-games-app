import { useState } from 'react';
import { ChevronRight, MoreHorizontal } from 'lucide-react';
import { confirmDialog } from '../../components/ConfirmDialog';
import { hatbandFor } from '../../lib/laneOrder';
import { publicRiderName } from '../../lib/riderNames';
import type { DeclarationForm, Heat, Race } from '../../types';
import { byDrawnLane, type LaneRules } from './laneRules';
import { HeatGrid, LaneBand, type RefereeCard } from './ScoringParts';

/** One heat in the picker's list. */
export interface HeatPickItem { key: string; label: string; status: string; selected: boolean; onSelect: () => void }

/** The full-width bar under the header: the arena in bold, then the age group and heat. It opens the list of heats. */
export function HeatPickerBar({ arena, label, items }: { arena: string; label: string; items: HeatPickItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="hb-bar">
      <button
        type="button"
        className="hb-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Heat: ${arena}, ${label}`}
        onClick={() => setOpen(!open)}
      >
        <span className="hb-arena">{arena}</span>
        <span className="hb-name">{label}</span>
        <ChevronRight className="hb-chev" aria-hidden="true" />
      </button>
      {open && (
        <span className="hb-menu" role="listbox" aria-label="Heats">
          {items.map((item) => (
            <button
              type="button"
              role="option"
              aria-selected={item.selected}
              key={item.key}
              onClick={() => { setOpen(false); item.onSelect(); }}
            >
              <span className="hb-item-label">{item.label}</span>
              <span className="hb-item-status">{item.status}</span>
            </button>
          ))}
        </span>
      )}
    </div>
  );
}

/** A heat you aren't scoring: its table, read only, with a way to score it anyway once the scorer has said they mean it. */
export function HeatTableView({ title, status, heat, races, rules, hcTeamIds, cardsByTeam, canOverride, arena, onScoreIt }: {
  title: string;
  status: string;
  heat: Heat;
  races: Race[];
  rules: LaneRules;
  hcTeamIds: ReadonlySet<number>;
  cardsByTeam?: Record<number, RefereeCard>;
  canOverride: boolean;
  arena: string;
  onScoreIt: () => void;
}) {
  async function ask() {
    const yes = await confirmDialog({
      title: `Score ${heat.label?.trim() || 'this heat'} in ${arena}?`,
      message: 'Another scorer may be on it. Anything you save replaces what is there for the same race.',
      confirmLabel: 'Score it',
    });
    if (yes) onScoreIt();
  }
  return (
    <div className="hv-page">
      <h2 className="hv-title">{title}</h2>
      <p className="hv-sub">{status}</p>
      <HeatGrid
        heat={heat}
        races={races}
        activeRaceId={null}
        activeIndex={0}
        rules={rules}
        pending={[]}
        pointsFor={() => 0}
        hcTeamIds={hcTeamIds}
        cardsByTeam={cardsByTeam}
      />
      {canOverride && <button type="button" className="mg-btn mg-btn-secondary hv-start" onClick={() => void ask()}>Score this heat</button>}
    </div>
  );
}

function ridersOf(form: DeclarationForm | undefined) {
  return (form?.riders ?? []).filter((r) => !r.isReserve).slice().sort((a, b) => a.orderIndex - b.orderIndex);
}

function flagsOf(form: DeclarationForm | undefined): string[] {
  return ridersOf(form).flatMap((r) => r.flags ?? []);
}

/** Between heats: who is in the next heat, in which lane, with their dec forms, and the way to start scoring it. */
export function BetweenHeats({ title, meta, heat, hatbands, decForms, startLabel, backLabel, onStart, onBack }: {
  title: string;
  meta: string;
  heat: Heat;
  hatbands?: string[] | null;
  decForms: ReadonlyMap<number, DeclarationForm>;
  startLabel: string;
  backLabel: string;
  onStart: () => void;
  onBack: () => void;
}) {
  const [openTeam, setOpenTeam] = useState<number | null>(null);
  const drawn = byDrawnLane(heat);
  return (
    <div className="hv-page">
      <h2 className="hv-title">{title}</h2>
      <p className="hv-sub">{meta}</p>
      <div className="bh-list">
        {drawn.map((e, i) => {
          const lane = String(i + 1);
          const form = decForms.get(e.teamId);
          const flags = flagsOf(form);
          const open = openTeam === e.teamId;
          return (
            <div className="bh-card" key={e.id}>
              <div className="bh-row">
                <LaneBand hatband={hatbandFor(hatbands, lane)} bib={e.bibColour} />
                <span className="bh-lane">L{lane}</span>
                <span className="bh-team">
                  <span className="bh-name">{e.teamName}</span>
                  {flags.length > 0 && <span className="bh-flag">{flags.length === 1 ? '1 flag' : `${flags.length} flags`}</span>}
                  {!form && <span className="bh-none">No dec form yet</span>}
                </span>
                {form && (
                  <button
                    type="button"
                    className="rt-dots"
                    aria-expanded={open}
                    aria-label={`${open ? 'Hide' : 'Show'} dec form for ${e.teamName}`}
                    onClick={() => setOpenTeam(open ? null : e.teamId)}
                  >
                    <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
                  </button>
                )}
              </div>
              {open && (
                <div className="bh-form">
                  {flags.map((f) => <span className="bh-flagline" key={f}>{f}</span>)}
                  {ridersOf(form).length === 0 && <span className="bh-none">No riders listed</span>}
                  {ridersOf(form).map((r) => (
                    <span className="bh-rider" key={r.id}><span>{publicRiderName(r)}</span><span className="bh-pony">{r.horseName ?? ''}</span></span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <button type="button" className="mg-btn mg-btn-primary hv-start" onClick={onStart}>{startLabel}</button>
      <button type="button" className="mg-btn mg-btn-secondary hv-start" onClick={onBack}>{backLabel}</button>
    </div>
  );
}
