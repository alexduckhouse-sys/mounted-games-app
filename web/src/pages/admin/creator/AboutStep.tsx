import { ChevronDown } from 'lucide-react';
import { CompetitionIcon } from '../../../competition/CompetitionIcon';
import { EMOJI_COMPETITION_ICONS, FLAG_COMPETITION_ICONS } from '../../../competition/icons';
import type { CreatorDraft } from '../../../lib/creatorDraft';
import { Field } from '../../auth/Field';
import { fieldClass, StepIntro, TextBox, type StepProps } from './parts';

export function AboutStep({ draft, change, problems, clear }: StepProps<CreatorDraft>) {
  return (
    <section aria-labelledby="cw-about" className="flex flex-col gap-[18px]">
      <StepIntro title="About the competition">What people will see first.</StepIntro>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <TextBox label="Name" value={draft.name} error={problems.name} onChange={(name) => { change({ name }); clear('name'); }} />
        <Field label="Icon">
          {({ id }) => (
            <div className={`${fieldClass} relative`}>
              <span className="text-lg text-[rgb(var(--mg-heading))]" data-testid="competition-icon-preview"><CompetitionIcon id={draft.icon} /></span>
              <select id={id} value={draft.icon} onChange={(e) => change({ icon: e.target.value })} className="appearance-none pr-6 font-medium">
                {EMOJI_COMPETITION_ICONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                <optgroup label="Flags">
                  {FLAG_COMPETITION_ICONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </optgroup>
              </select>
              <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 h-4 w-4 text-[rgb(var(--mg-heading))]" />
            </div>
          )}
        </Field>
      </div>
      <TextBox label="Organiser" value={draft.organiserName} onChange={(organiserName) => change({ organiserName })} />
    </section>
  );
}
