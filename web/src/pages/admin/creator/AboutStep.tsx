import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { useT } from '../../../i18n/LanguageContext';
import { COMPETITION_ICONS, competitionIcon } from '../../../competition/icons';
import { SHORT_NAME_MAX, type CreatorDraft } from '../../../lib/creatorDraft';
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
  const t = useT();
  const [query, setQuery] = useState('');
  const current = competitionIcon(value);
  const q = query.trim().toLowerCase();
  const list = useMemo(() => COMPETITION_ICONS.filter((icon) => !q || icon.label.toLowerCase().includes(q)), [q]);

  return (
    <RefinePanelRow label={t('admin.creator.icon.label')} ariaLabel={t('admin.creator.icon.aria', { label: current.label })} value={<><IconGlyph id={current.id} />{current.label}</>}>
      {(close) => (
        <div className="cw-icons">
          <input type="search" autoFocus aria-label={t('admin.creator.icon.search')} placeholder={t('common.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
          <div role="listbox" aria-label={t('admin.creator.icon.label')} className="cw-icons-list">
            {list.map((icon) => (
              <button key={icon.id} type="button" role="option" aria-selected={icon.id === current.id} className="rf-choice" onClick={() => { close(); setQuery(''); onChange(icon.id); }}>
                <IconGlyph id={icon.id} /><span>{icon.label}</span>{icon.id === current.id && <Check className="h-4 w-4" aria-hidden="true" />}
              </button>
            ))}
            {list.length === 0 && <p className="rf-note" style={{ padding: '14px 16px' }}>{t('admin.creator.noMatch')}</p>}
          </div>
        </div>
      )}
    </RefinePanelRow>
  );
}

export function AboutStep({ draft, change, problems, clear }: StepProps<CreatorDraft>) {
  const t = useT();
  return (
    <section aria-label={t('admin.creator.step.about')} className="flex flex-col gap-3">
      <StepHeading>{t('admin.creator.step.about')}</StepHeading>
      <div className="cw-card">
        <div className="cw-panel">
          <TextBox label={t('admin.creator.name')} value={draft.name} error={problems.name} onChange={(name) => { change({ name }); clear('name'); }} />
          <TextBox label={t('admin.creator.organiser')} value={draft.organiserName} onChange={(organiserName) => change({ organiserName })} />
          <TextBox label={<>{t('admin.creator.shortName')} <span className="font-normal text-[rgb(var(--mg-muted))]">{t('admin.creator.optional')}</span></>}
            value={draft.shortName} maxLength={SHORT_NAME_MAX} hint={t('admin.creator.shortNameHint')} onChange={(shortName) => change({ shortName })} />
        </div>
        <IconPicker value={draft.icon} onChange={(icon) => change({ icon })} />
      </div>
    </section>
  );
}
