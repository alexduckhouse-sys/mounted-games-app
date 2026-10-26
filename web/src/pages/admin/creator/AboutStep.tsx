import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { COMPETITION_ICONS, competitionIcon } from '../../../competition/icons';
import type { CreatorDraft } from '../../../lib/creatorDraft';
import { RefinePanelRow } from '../../refine/Refine';
import { StepHeading } from './controls';
import { TextBox, type StepProps } from './parts';

/** One icon's picture: an emoji, or its flag image. */
export function IconGlyph({ id }: { id: string }) {
  const icon = competitionIcon(id);
  return <span className="cw-flag" aria-hidden="true">{icon.src ? <img src={icon.src} alt="" loading="lazy" draggable={false} /> : icon.symbol}</span>;
}

/**
 * The icon: three symbols, the four nations and the UK, then every country A to Z. A settings row that opens a list with
 * a search box; typing narrows it.
 */
export function IconPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const current = competitionIcon(value);
  const q = query.trim().toLowerCase();
  const list = useMemo(() => COMPETITION_ICONS.filter((icon) => !q || icon.label.toLowerCase().includes(q)), [q]);

  return (
    <RefinePanelRow label="Icon" ariaLabel={`Icon: ${current.label}`} value={<><IconGlyph id={current.id} />{current.label}</>}>
      {(close) => (
        <div className="cw-icons">
          <input type="search" autoFocus aria-label="Search icons" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div role="listbox" aria-label="Icon" className="cw-icons-list">
            {list.map((icon) => (
              <button key={icon.id} type="button" role="option" aria-selected={icon.id === current.id} className="rf-choice" onClick={() => { close(); setQuery(''); onChange(icon.id); }}>
                <IconGlyph id={icon.id} /><span>{icon.label}</span>{icon.id === current.id && <Check className="h-4 w-4" aria-hidden="true" />}
              </button>
            ))}
            {list.length === 0 && <p className="rf-note" style={{ padding: '14px 16px' }}>No match.</p>}
          </div>
        </div>
      )}
    </RefinePanelRow>
  );
}

export function AboutStep({ draft, change, problems, clear }: StepProps<CreatorDraft>) {
  return (
    <section aria-label="About" className="flex flex-col gap-3">
      <StepHeading>About</StepHeading>
      <div className="cw-card">
        <div className="cw-panel">
          <TextBox label="Name" value={draft.name} error={problems.name} onChange={(name) => { change({ name }); clear('name'); }} />
          <TextBox label="Organiser" value={draft.organiserName} onChange={(organiserName) => change({ organiserName })} />
        </div>
        <IconPicker value={draft.icon} onChange={(icon) => change({ icon })} />
      </div>
    </section>
  );
}
