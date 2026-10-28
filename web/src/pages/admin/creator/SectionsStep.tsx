import { useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { LeavingRow } from '../../../components/LeavingRow';
import { useT } from '../../../i18n/LanguageContext';
import {
  AGE_GROUP_PRESETS, defaultSection, lanesOfArena, sectionName, setFormat, type CreatorDraft, type Format, type SectionDraft,
} from '../../../lib/creatorDraft';
import { RefineChoiceRow } from '../../refine/Refine';
import { AddBar, SecHead, StepHeading, StepperRow } from './controls';
import type { StepProps } from './parts';

/** The age groups people can enter: each one's type, age group, price and entry limit. */
export function SectionsStep({ draft, change, problems, clear }: StepProps<CreatorDraft>) {
  const t = useT();
  const types = [{ value: '3', label: t('admin.creator.format.3') }, { value: '1', label: t('admin.creator.format.1') }, { value: '2', label: t('admin.creator.format.2') }];
  const update = (i: number, patch: Partial<SectionDraft> | ((s: SectionDraft) => SectionDraft)) =>
    change({ sections: draft.sections.map((s, idx) => (idx === i ? (typeof patch === 'function' ? patch(s) : { ...s, ...patch }) : s)) });
  // A steady number for each section, so one that is removed folds away and the others keep their place (new ones have no id yet).
  const [marks, setMarks] = useState(() => draft.sections.map((_, i) => i));
  if (marks.length !== draft.sections.length) {
    const top = Math.max(-1, ...marks);
    setMarks(draft.sections.map((_, i) => marks[i] ?? top + 1 + i));
  }
  const ages = useMemo(() => AGE_GROUP_PRESETS.map((a) => ({ value: a, label: a })), []);

  function add() {
    // The next age group that isn't there yet, so a new row starts out valid.
    const taken = new Set(draft.sections.map((s) => s.ageGroup.toLowerCase()));
    const next = AGE_GROUP_PRESETS.find((a) => !taken.has(a.toLowerCase())) ?? '';
    const arena = draft.arenas[0];
    const base = defaultSection();
    setMarks([...marks, Math.max(-1, ...marks) + 1]);
    change({
      sections: [...draft.sections, {
        ...base, ageGroup: next, maxParticipants: '10',
        arena: arena?.name ?? base.arena, maxTeamsPerHeat: arena ? String(lanesOfArena(arena)) : base.maxTeamsPerHeat,
      }],
    });
  }

  return (
    <section aria-label={t('admin.creator.step.sections')} className="flex flex-col">
      <StepHeading>{t('admin.creator.step.sections')}</StepHeading>
      <AnimatePresence initial={false}>
      {draft.sections.map((s, i) => {
        const fixed = s.existingId != null;
        const taken = problems[`section.${i}.ageGroup`];
        const name = s.ageGroup.trim() ? sectionName(s) : t('admin.creator.sections.sectionN', { n: i + 1 });
        return (
          <LeavingRow as="div" key={s.existingId ?? `new-${marks[i]}`}>
          <div role="group" aria-label={name}>
            <SecHead name={name} first={i === 0} />
            <div className="cw-card">
              <RefineChoiceRow label={t('admin.creator.sections.type')} value={String(s.format)} options={types} disabled={fixed}
                onChange={(v) => update(i, (cur) => setFormat(cur, parseInt(v, 10) as Format))} />
              <RefineChoiceRow label={t('admin.creator.sections.ageGroup')} value={s.ageGroup} options={ages} allowOther disabled={fixed} placeholder={t('admin.creator.choose')}
                onChange={(ageGroup) => { update(i, { ageGroup }); clear(`section.${i}.ageGroup`); }} />
              <StepperRow label={t('admin.creator.sections.price')} name={t('admin.creator.sections.priceIn', { name })} value={s.priceGbp || '0'} min={0} max={500} decimals={2} width={76}
                onChange={(n) => update(i, { priceGbp: n === 0 ? '' : String(n) })} />
              <StepperRow label={t('admin.creator.sections.maxEntries')} name={t('admin.creator.sections.maxEntriesFor', { name })} value={s.maxParticipants} min={0} max={60} start={10} width={88} empty={t('admin.creator.sections.none')}
                onChange={(n) => update(i, { maxParticipants: n === 0 ? '' : String(n) })} />
              <div className="cw-row" style={{ justifyContent: 'space-between' }}>
                <span className="cw-t2">{fixed ? t(s.hasEntries ? 'admin.creator.sections.fixedEntries' : 'admin.creator.sections.fixed') : ''}</span>
                <button type="button" className="cw-btn cw-btn-s cw-btn-d" disabled={draft.sections.length < 2 || !!s.hasEntries} aria-label={t('admin.creator.sections.removeAria', { name })}
                  onClick={() => { setMarks(marks.filter((_, idx) => idx !== i)); change({ sections: draft.sections.filter((_, idx) => idx !== i) }); }}>{t('admin.creator.remove')}</button>
              </div>
            </div>
            {taken && <p role="alert" aria-invalid="true" tabIndex={-1} className="cw-note" style={{ color: 'rgb(var(--mg-elim))' }}>{taken}</p>}
          </div>
          </LeavingRow>
        );
      })}
      </AnimatePresence>
      <div className="mt-4"><AddBar onClick={add}>{t('admin.creator.sections.add')}</AddBar></div>
    </section>
  );
}
