import { useMemo } from 'react';
import {
  AGE_GROUP_PRESETS, defaultSection, FORMAT_LABEL, lanesOfArena, sectionName, setFormat, type CreatorDraft, type Format, type SectionDraft,
} from '../../../lib/creatorDraft';
import { RefineChoiceRow } from '../../refine/Refine';
import { AddBar, SecHead, StepHeading, StepperRow } from './controls';
import type { StepProps } from './parts';

const TYPES = [{ value: '3', label: FORMAT_LABEL[3] }, { value: '1', label: FORMAT_LABEL[1] }, { value: '2', label: FORMAT_LABEL[2] }];

/** The age groups people can enter: each one's type, age group, price and entry limit. */
export function SectionsStep({ draft, change, problems, clear }: StepProps<CreatorDraft>) {
  const update = (i: number, patch: Partial<SectionDraft> | ((s: SectionDraft) => SectionDraft)) =>
    change({ sections: draft.sections.map((s, idx) => (idx === i ? (typeof patch === 'function' ? patch(s) : { ...s, ...patch }) : s)) });
  const ages = useMemo(() => AGE_GROUP_PRESETS.map((a) => ({ value: a, label: a })), []);

  function add() {
    // The next age group that isn't there yet, so a new row starts out valid.
    const taken = new Set(draft.sections.map((s) => s.ageGroup.toLowerCase()));
    const next = AGE_GROUP_PRESETS.find((a) => !taken.has(a.toLowerCase())) ?? '';
    const arena = draft.arenas[0];
    const base = defaultSection();
    change({
      sections: [...draft.sections, {
        ...base, ageGroup: next, maxParticipants: '10',
        arena: arena?.name ?? base.arena, maxTeamsPerHeat: arena ? String(lanesOfArena(arena)) : base.maxTeamsPerHeat,
      }],
    });
  }

  return (
    <section aria-label="Sections" className="flex flex-col">
      <StepHeading>Sections</StepHeading>
      {draft.sections.map((s, i) => {
        const fixed = s.existingId != null;
        const taken = problems[`section.${i}.ageGroup`];
        const name = s.ageGroup.trim() ? sectionName(s) : `Section ${i + 1}`;
        return (
          <div key={s.existingId ?? `new-${i}`} role="group" aria-label={name}>
            <SecHead name={name} first={i === 0} />
            <div className="cw-card">
              <RefineChoiceRow label="Type" value={String(s.format)} options={TYPES} disabled={fixed}
                onChange={(v) => update(i, (cur) => setFormat(cur, parseInt(v, 10) as Format))} />
              <RefineChoiceRow label="Age group" value={s.ageGroup} options={ages} allowOther disabled={fixed} placeholder="Choose"
                onChange={(ageGroup) => { update(i, { ageGroup }); clear(`section.${i}.ageGroup`); }} />
              <StepperRow label="Price (£)" name={`Price in pounds, ${name}`} value={s.priceGbp || '0'} min={0} max={500}
                onChange={(n) => update(i, { priceGbp: n === 0 ? '' : String(n) })} />
              <StepperRow label="Max entries" name={`Max entries, ${name}`} value={s.maxParticipants} min={1} max={60} start={10} empty="None"
                onChange={(n) => update(i, { maxParticipants: String(n) })} />
              <div className="cw-row" style={{ justifyContent: 'space-between' }}>
                <span className="cw-t2">{fixed ? `The type and age group can’t change once saved.${s.hasEntries ? ' It has entries, so it can’t be removed.' : ''}` : ''}</span>
                <button type="button" className="cw-btn cw-btn-s cw-btn-d" disabled={draft.sections.length < 2 || !!s.hasEntries} aria-label={`Remove ${name}`}
                  onClick={() => change({ sections: draft.sections.filter((_, idx) => idx !== i) })}>Remove</button>
              </div>
            </div>
            {taken && <p role="alert" aria-invalid="true" tabIndex={-1} className="cw-note" style={{ color: 'rgb(var(--mg-elim))' }}>{taken}</p>}
          </div>
        );
      })}
      <div className="mt-4"><AddBar onClick={add}>Add a section</AddBar></div>
    </section>
  );
}
