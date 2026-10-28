import { SlidersHorizontal } from 'lucide-react';
import { Sheet } from './Sheet';
import './filterKit.css';

export interface AgeGroupOption { id: number | 'all'; label: string; teams: number }

/** The round filter button that sits beside a team search box; a small count shows when an age group is picked. */
export function AgeGroupFilterButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" className="fk-fbtn" aria-label={active ? `${label}, 1 set` : label} onClick={onClick}>
      <SlidersHorizontal aria-hidden="true" className="h-5 w-5" />
      {active && <span className="fk-count" aria-hidden="true">1</span>}
    </button>
  );
}

/** The sheet the filter button opens: one tile per age group, and a button showing how many teams that leaves. */
export function AgeGroupFilterSheet({ title, options, value, shown, onChange, onClose }: {
  title: string;
  options: AgeGroupOption[];
  value: number | 'all';
  /** How many teams the current choice shows, for the "Show 12 teams" button. */
  shown: number;
  onChange: (id: number | 'all') => void;
  onClose: () => void;
}) {
  return (
    <Sheet title={title} className="fk-sheet" onClose={onClose}>
      {({ close }) => (
        <>
          <div className="fk-tiles" role="group" aria-label={title}>
            {options.map((option) => (
              <button key={option.id} type="button" className="fk-tile" aria-pressed={value === option.id} onClick={() => onChange(option.id)}>
                <strong>{option.label}</strong>
                <span>{option.teams === 1 ? '1 team' : `${option.teams} teams`}</span>
              </button>
            ))}
          </div>
          <button type="button" className="kit-pill kit-pill-fill fk-show" onClick={() => close()}>
            Show {shown} {shown === 1 ? 'team' : 'teams'}
          </button>
        </>
      )}
    </Sheet>
  );
}
