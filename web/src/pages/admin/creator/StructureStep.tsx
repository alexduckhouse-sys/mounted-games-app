import { useMemo } from 'react';
import { describeHeats } from '../../../lib/formatPlan';
import {
  MAX_SESSIONS, resizeSessions, sectionHasFinal, sectionLocked, sectionName, setRaceFinals, type CreatorDraft, type SectionDraft,
} from '../../../lib/creatorDraft';
import { setSectionArena } from '../../../lib/creatorArenas';
import { durationText, estimateText, sectionEstimate } from '../../../lib/creatorPlan';
import { RefineChoiceRow, RefineSwitchRow } from '../../refine/Refine';
import { SecHead, StepHeading, Stepper } from './controls';
import { HatbandEditor } from './Hatbands';
import type { StepProps } from './parts';

const FORMATS = [{ value: 'std', label: 'Standard' }, { value: 'hhf', label: 'Heat, heat, final' }];
const TIES = [
  { value: '0', label: 'Countback' }, { value: '1', label: 'Last race' }, { value: '2', label: 'Run-off' }, { value: '3', label: 'Decide on the day' },
];
const LANES = [{ value: '0', label: 'Move up one' }, { value: '1', label: 'Stay in lane' }, { value: '2', label: 'Move down one' }];

/** How each age group runs, how long it takes, what breaks a tie, and the hatbands. This is what the timetable is built from. */
export function StructureStep({ draft, change, problems, clear, templates, teamCounts }: StepProps<CreatorDraft> & {
  /** Names of the races in the library, for the run-off race. */
  templates: string[];
  teamCounts: Readonly<Record<number, number>>;
}) {
  const update = (i: number, next: (s: SectionDraft) => SectionDraft) =>
    change({ sections: draft.sections.map((s, idx) => (idx === i ? next(s) : s)) });
  const patch = (i: number, p: Partial<SectionDraft>) => update(i, (s) => ({ ...s, ...p }));
  const arenaOptions = useMemo(() => draft.arenas.map((a) => ({ value: a.name, label: a.name })), [draft.arenas]);
  const raceOptions = useMemo(() => templates.map((t) => ({ value: t, label: t })), [templates]);

  return (
    <section aria-label="Structure and timing" className="flex flex-col">
      <StepHeading>Structure and timing</StepHeading>
      {draft.sections.map((s, i) => {
        const locked = sectionLocked(s);
        const name = sectionName(s);
        const est = sectionEstimate(s, s.existingId ? teamCounts[s.existingId] ?? 0 : 0);
        const tie = String(s.tieBreak ?? 0);
        const minutesError = problems[`section.${i}.minutes`];
        return (
          <div key={s.existingId ?? `new-${i}`} role="group" aria-label={`Structure for ${name}`}>
            <SecHead name={name} first={i === 0} />
            <div className="cw-card">
              <RefineChoiceRow label="Format" value={s.usesRaceFinals ? 'hhf' : 'std'} options={FORMATS} disabled={locked}
                onChange={(v) => update(i, (cur) => setRaceFinals(cur, v === 'hhf'))} />
              <div className="cw-panel" style={{ paddingBlock: 12 }}>
                <div className="cw-line" style={{ alignItems: 'flex-end' }}>
                  <div className="cw-stp-field" style={{ flex: '0 0 auto' }}>
                    <span>Sessions</span>
                    <Stepper name={`Sessions, ${name}`} value={String(s.sessions.length)} min={1} max={s.usesRaceFinals || locked ? s.sessions.length : MAX_SESSIONS}
                      onChange={(n) => update(i, (cur) => resizeSessions(cur, n))} />
                  </div>
                  <div className="cw-stp-field" style={{ flex: '0 0 auto' }}>
                    <span>Minutes per heat</span>
                    <Stepper name={`Minutes per heat, ${name}`} value={s.minutesPerRace} min={1} max={180} step={5}
                      onChange={(n) => { patch(i, { minutesPerRace: String(n) }); clear(`section.${i}.minutes`); }} />
                  </div>
                </div>
                {minutesError && <p role="alert" className="cw-note" style={{ color: 'rgb(var(--mg-elim))', margin: 0 }}>{minutesError}</p>}
                {s.usesRaceFinals && <p className="cw-t2">Heat, heat, final runs as one session. Every race is two qualifier heats and then a final.</p>}
              </div>
              {draft.arenas.length > 1 && (
                <RefineChoiceRow label="Arena" value={s.arena} options={arenaOptions}
                  onChange={(arena) => { change({ sections: setSectionArena(draft, i, arena) }); clear(`section.${i}.arena`); }} />
              )}
              <span className="cw-subhead">Scoring extras</span>
              <RefineChoiceRow label="Tie-break" value={tie} options={TIES} onChange={(v) => patch(i, { tieBreak: parseInt(v, 10) })} />
              {tie === '2' && (
                <RefineChoiceRow label="Run-off race" value={s.runoffRaceName} options={raceOptions} allowOther placeholder="Choose"
                  onChange={(runoffRaceName) => patch(i, { runoffRaceName })} />
              )}
              {!s.usesRaceFinals && (
                <RefineChoiceRow label="Lane after each race" value={String(s.laneRotation ?? 0)} options={LANES} disabled={locked}
                  onChange={(v) => patch(i, { laneRotation: parseInt(v, 10) })} />
              )}
              {sectionHasFinal(s) && (
                <>
                  <RefineSwitchRow label="Carry points into the final" on={s.carryPointsIntoFinal === true} onChange={(on) => patch(i, { carryPointsIntoFinal: on })} />
                  <RefineSwitchRow label="Double points in the final" on={s.doublePointsInFinal === true} disabled={!!s.finalScored} onChange={(on) => patch(i, { doublePointsInFinal: on })} />
                </>
              )}
            </div>
            {locked && <p className="cw-note">Heats have been made or scores entered for this age group, so its structure is fixed. You can still change the minutes and the tie-break.</p>}
            <p className="cw-note" aria-live="polite">
              Estimate: {estimateText(est.teams)}, {s.usesRaceFinals ? 'qualifier heats and a final for each race' : describeHeats(est.sizes)}, about {durationText(est.minutesPerSession)} a session.
            </p>
          </div>
        );
      })}
      <HatbandEditor draft={draft} change={change} />
    </section>
  );
}
