import { useT } from '../../../i18n/LanguageContext';
import { changeArenas, resizeArenas } from '../../../lib/creatorArenas';
import { lanesOfArena, MAX_ARENA_LANES, MAX_ARENAS, MIN_ARENA_LANES, type CreatorDraft } from '../../../lib/creatorDraft';
import { Field } from '../../auth/Field';
import { Stepper, StepperRow, StepHeading } from './controls';
import { fieldClass, type StepProps } from './parts';

/** How many arenas there are, what each is called and how many lanes it has. Age groups pick one on Structure and timing. */
export function ArenasStep({ draft, change, problems, clear }: StepProps<CreatorDraft>) {
  const t = useT();
  const patch = (i: number, p: Partial<CreatorDraft['arenas'][number]>) =>
    change(changeArenas(draft, draft.arenas.map((a, j) => (j === i ? { ...a, ...p } : a))));

  return (
    <section aria-label={t('admin.creator.step.arenas')} className="flex flex-col">
      <StepHeading>{t('admin.creator.step.arenas')}</StepHeading>
      <div className="cw-card mt-3">
        <StepperRow label={t('admin.creator.arenas.howMany')} name={t('admin.creator.arenas.number')} value={String(draft.arenas.length)} min={1} max={MAX_ARENAS}
          onChange={(n) => change(resizeArenas(draft, n))} />
        {draft.arenas.map((a, i) => (
          <div key={i} className="cw-row" style={{ alignItems: 'flex-end', flexWrap: 'wrap', paddingTop: 12, paddingBottom: 14 }}>
            <Field label={t('admin.creator.arenas.arenaN', { n: i + 1 })} error={problems[`arena.${i}.name`]} className="min-w-[200px] flex-1">
              {({ id, invalid, describedBy }) => (
                <div className={fieldClass} data-invalid={invalid}>
                  <input id={id} value={a.name} aria-invalid={invalid} aria-describedby={describedBy} autoComplete="off"
                    onChange={(e) => { patch(i, { name: e.target.value }); clear(`arena.${i}.name`); }} />
                </div>
              )}
            </Field>
            <div className="cw-stp-field">
              <span>{t('admin.creator.arenas.maxLanes')}</span>
              <Stepper name={t('admin.creator.arenas.maxLanesFor', { name: a.name.trim() || t('admin.creator.arenas.arenaLower', { n: i + 1 }) })} value={String(lanesOfArena(a))} min={MIN_ARENA_LANES} max={MAX_ARENA_LANES}
                onChange={(n) => patch(i, { lanes: String(n) })} />
            </div>
          </div>
        ))}
      </div>
      <p className="cw-note">{t('admin.creator.arenas.note')}</p>
    </section>
  );
}
