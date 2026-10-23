import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  AGE_GROUP_PRESETS, defaultSection, FORMAT_LABEL, sectionName, setFormat, type CreatorDraft, type Format, type SectionDraft,
} from '../../../lib/creatorDraft';
import { NumberBox, SelectBox, StepIntro, TextBox, type StepProps } from './parts';

const OWN = '__own__';

export function SectionsStep({ draft, change, problems, clear }: StepProps<CreatorDraft>) {
  // Rows where the person chose "Type your own…" and hasn't typed anything yet.
  const [typing, setTyping] = useState<ReadonlySet<number>>(new Set());
  const update = (i: number, patch: Partial<SectionDraft> | ((s: SectionDraft) => SectionDraft)) =>
    change({ sections: draft.sections.map((s, idx) => (idx === i ? (typeof patch === 'function' ? patch(s) : { ...s, ...patch }) : s)) });

  function add() {
    // The next age group that isn't there yet, so a new row starts out valid.
    const taken = new Set(draft.sections.map((s) => `${s.format}|${s.ageGroup.toLowerCase()}`));
    const next = AGE_GROUP_PRESETS.find((a) => !taken.has(`2|${a.toLowerCase()}`)) ?? '';
    change({ sections: [...draft.sections, { ...defaultSection(), ageGroup: next }] });
  }

  function remove(i: number) {
    setTyping(new Set());
    change({ sections: draft.sections.filter((_, idx) => idx !== i) });
  }

  return (
    <section aria-labelledby="cw-sections" className="flex flex-col gap-[18px]">
      <StepIntro title="What people can enter">One block for each age group. Give each its format, price and the most entries you will take.</StepIntro>
      <div className="flex flex-col gap-4">
        {draft.sections.map((s, i) => {
          const fixed = s.existingId != null;
          const own = typing.has(i) || (!!s.ageGroup && !AGE_GROUP_PRESETS.includes(s.ageGroup));
          const age = problems[`section.${i}.ageGroup`];
          return (
            <div key={i} role="group" aria-label={`Section ${i + 1}`} className="mg-card flex flex-col gap-3 p-4">
              <div className="flex items-center gap-3">
                <strong className="min-w-0 flex-1 truncate text-[17px] text-[rgb(var(--mg-heading))]">{s.ageGroup.trim() ? sectionName(s) : `Section ${i + 1}`}</strong>
                <button type="button" onClick={() => remove(i)} disabled={draft.sections.length < 2 || !!s.hasEntries} aria-label={`Remove section ${i + 1}`}
                  className="flex h-11 w-11 items-center justify-center rounded-lg text-[rgb(var(--mg-muted))] hover:bg-[rgb(var(--mg-subtle))] disabled:cursor-not-allowed disabled:opacity-40">
                  <Trash2 aria-hidden="true" className="h-[18px] w-[18px]" />
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <SelectBox label="Format" value={s.format} disabled={fixed} onChange={(v) => update(i, (cur) => setFormat(cur, parseInt(v, 10) as Format))}>
                  {Object.entries(FORMAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </SelectBox>
                <SelectBox label="Age group" value={own ? OWN : s.ageGroup} disabled={fixed} error={own ? null : age}
                  onChange={(v) => {
                    clear(`section.${i}.ageGroup`);
                    if (v === OWN) { setTyping(new Set([...typing, i])); update(i, { ageGroup: '' }); return; }
                    setTyping(new Set([...typing].filter((n) => n !== i)));
                    update(i, { ageGroup: v });
                  }}>
                  {!s.ageGroup && !own && <option value="" disabled>Choose</option>}
                  {AGE_GROUP_PRESETS.map((a) => <option key={a} value={a}>{a}</option>)}
                  {!fixed && <option value={OWN}>Type your own…</option>}
                  {fixed && !AGE_GROUP_PRESETS.includes(s.ageGroup) && <option value={OWN}>{s.ageGroup}</option>}
                </SelectBox>
              </div>
              {own && !fixed && (
                <TextBox label="Your age group" value={s.ageGroup} error={age} placeholder="For example Under 8 or Veterans"
                  onChange={(ageGroup) => { update(i, { ageGroup }); clear(`section.${i}.ageGroup`); }} />
              )}
              <div className="grid grid-cols-2 gap-3">
                <NumberBox label="Price" decimal prefix="£" placeholder="0" value={s.priceGbp} error={problems[`section.${i}.price`]} onChange={(priceGbp) => update(i, { priceGbp })} />
                <NumberBox label="Max entries" placeholder="No cap" value={s.maxParticipants} error={problems[`section.${i}.max`]} onChange={(maxParticipants) => update(i, { maxParticipants })} />
              </div>
              {fixed && <p className="text-xs text-[rgb(var(--mg-muted))]">The format and age group can’t change once saved.{s.hasEntries ? ' This age group has entries, so it can’t be removed.' : ''}</p>}
            </div>
          );
        })}
        <button type="button" onClick={add} className="mg-btn mg-btn-secondary !min-h-12 self-start">
          <Plus aria-hidden="true" className="h-[18px] w-[18px]" />Add a section
        </button>
      </div>
    </section>
  );
}
