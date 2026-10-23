import { describeHeats } from '../../../lib/formatPlan';
import { MAX_SESSIONS, resizeSessions, sectionLocked, sectionName, setRaceFinals, type CreatorDraft, type SectionDraft } from '../../../lib/creatorDraft';
import { durationText, estimateText, sectionEstimate } from '../../../lib/creatorPlan';
import { NumberBox, SelectBox, StepIntro, TextBox, type StepProps } from './parts';

export function StructureStep({ draft, change, problems, clear, templates, teamCounts }: StepProps<CreatorDraft> & {
  /** Names of the races in the library, for the run-off race. */
  templates: string[];
  teamCounts: Readonly<Record<number, number>>;
}) {
  const update = (i: number, next: (s: SectionDraft) => SectionDraft) =>
    change({ sections: draft.sections.map((s, idx) => (idx === i ? next(s) : s)) });
  const patch = (i: number, p: Partial<SectionDraft>) => update(i, (s) => ({ ...s, ...p }));

  return (
    <section aria-labelledby="cw-structure" className="flex flex-col gap-[18px]">
      <StepIntro title="Structure and timing">How each age group runs, and how long it takes. This is what the timetable is built from.</StepIntro>
      <div className="flex flex-col gap-4">
        {draft.sections.map((s, i) => {
          const locked = sectionLocked(s);
          const est = sectionEstimate(s, s.existingId ? teamCounts[s.existingId] ?? 0 : 0);
          const runoff = s.runoffRaceName;
          return (
            <div key={s.existingId ?? `new-${i}`} role="group" aria-label={`Structure for ${sectionName(s)}`} className="mg-card flex flex-col gap-4 p-4">
              <strong className="text-[17px] text-[rgb(var(--mg-heading))]">{sectionName(s)}</strong>
              {locked && <p className="mg-notice">Heats have been made or scores entered for this age group, so its structure is fixed. You can still change the minutes and the arena.</p>}

              <div className="flex flex-col gap-2 text-[15px] font-medium">
                <span id={`cw-struct-${i}`}>Structure</span>
                <div role="radiogroup" aria-labelledby={`cw-struct-${i}`} className="flex min-h-12 gap-0.5 rounded-[10px] bg-[rgb(var(--mg-done-bg))] p-[3px]">
                  {([['Standard', false, 'Standard, several sessions'], ['Heat, heat, final', true, 'Heat, heat, final (HHF)']] as const).map(([label, value, aria]) => (
                    <button key={label} type="button" role="radio" aria-checked={s.usesRaceFinals === value} aria-label={aria} disabled={locked}
                      onClick={() => update(i, (cur) => setRaceFinals(cur, value))}
                      className={`flex-1 rounded-lg px-2 text-sm font-semibold disabled:opacity-60 ${s.usesRaceFinals === value ? 'bg-[rgb(var(--mg-button))] text-white' : 'text-[rgb(var(--mg-body))]'}`}>{label}</button>
                  ))}
                </div>
                <span className="text-xs font-normal text-[rgb(var(--mg-muted))]">
                  {s.usesRaceFinals ? 'Every race is two qualifier heats and then a final. It runs as one session.' : 'Teams race in heats, and points add up across the races.'}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <SelectBox label="Sessions" value={s.sessions.length} disabled={locked || s.usesRaceFinals} onChange={(v) => update(i, (cur) => resizeSessions(cur, parseInt(v, 10)))}
                  hint={s.usesRaceFinals ? 'Heat, heat, final uses one session.' : 'Each session is a block of heats on the timetable.'}>
                  {Array.from({ length: MAX_SESSIONS }, (_, n) => <option key={n} value={n + 1}>{n + 1}</option>)}
                </SelectBox>
                <NumberBox label="Teams through to the final" placeholder="Not set" value={s.finalistCount} error={problems[`section.${i}.finalists`]} disabled={locked}
                  onChange={(finalistCount) => { patch(i, { finalistCount }); clear(`section.${i}.finalists`); }} />
              </div>

              <SelectBox label="Run-off race" value={runoff} disabled={locked} onChange={(runoffRaceName) => patch(i, { runoffRaceName })} hint="Used to split teams that tie.">
                <option value="">None</option>
                {runoff && !templates.includes(runoff) && <option value={runoff}>{runoff}</option>}
                {templates.map((name) => <option key={name} value={name}>{name}</option>)}
              </SelectBox>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <NumberBox label="Minutes per race" suffix="min" value={s.minutesPerRace} error={problems[`section.${i}.minutes`]}
                  hint="A heat runs every race, so it takes this times the races."
                  onChange={(minutesPerRace) => { patch(i, { minutesPerRace }); clear(`section.${i}.minutes`); }} />
                <NumberBox label="Max teams per heat" value={s.maxTeamsPerHeat} error={problems[`section.${i}.heat`]} disabled={locked}
                  onChange={(maxTeamsPerHeat) => { patch(i, { maxTeamsPerHeat }); clear(`section.${i}.heat`); }} />
                <TextBox label="Arena" value={s.arena} error={problems[`section.${i}.arena`]} hint="Same arena: one after another. Different arenas run side by side."
                  onChange={(arena) => { patch(i, { arena }); clear(`section.${i}.arena`); }} />
              </div>

              <p className="rounded-lg bg-[rgb(var(--mg-subtle))] px-3 py-2 text-sm text-[rgb(var(--mg-body))]" aria-live="polite">
                Estimate: {estimateText(est.teams)}, {s.usesRaceFinals ? 'qualifier heats and a final for each race' : describeHeats(est.sizes)}, about {durationText(est.minutesPerSession)} a session.
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
