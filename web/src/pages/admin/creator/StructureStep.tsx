import { useMemo } from 'react';
import { useT } from '../../../i18n/LanguageContext';
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

/** How each age group runs, how long it takes, what breaks a tie, and the hatbands. This is what the timetable is built from. */
export function StructureStep({ draft, change, problems, clear, templates, teamCounts }: StepProps<CreatorDraft> & {
  /** Names of the races in the library, for the run-off race. */
  templates: string[];
  teamCounts: Readonly<Record<number, number>>;
}) {
  const t = useT();
  const FORMATS = [{ value: 'std', label: t('admin.creator.structure.standard') }, { value: 'hhf', label: t('admin.creator.structure.hhf') }];
  const TIES = [
    { value: '0', label: t('admin.creator.structure.tie.0') }, { value: '1', label: t('admin.creator.structure.tie.1') },
    { value: '2', label: t('admin.creator.structure.tie.2') }, { value: '3', label: t('admin.creator.structure.tie.3') },
  ];
  const LANES = [{ value: '0', label: t('admin.creator.structure.lane.0') }, { value: '1', label: t('admin.creator.structure.lane.1') }, { value: '2', label: t('admin.creator.structure.lane.2') }];
  const update = (i: number, next: (s: SectionDraft) => SectionDraft) =>
    change({ sections: draft.sections.map((s, idx) => (idx === i ? next(s) : s)) });
  const patch = (i: number, p: Partial<SectionDraft>) => update(i, (s) => ({ ...s, ...p }));
  const arenaOptions = useMemo(() => draft.arenas.map((a) => ({ value: a.name, label: a.name })), [draft.arenas]);
  const raceOptions = useMemo(() => templates.map((tpl) => ({ value: tpl, label: tpl })), [templates]);

  return (
    <section aria-label={t('admin.creator.step.structure')} className="flex flex-col">
      <StepHeading>{t('admin.creator.step.structure')}</StepHeading>
      {draft.sections.map((s, i) => {
        const locked = sectionLocked(s);
        const name = sectionName(s);
        const est = sectionEstimate(s, s.existingId ? teamCounts[s.existingId] ?? 0 : 0);
        const tie = String(s.tieBreak ?? 0);
        const minutesError = problems[`section.${i}.minutes`];
        return (
          <div key={s.existingId ?? `new-${i}`} role="group" aria-label={t('admin.creator.structure.forName', { name })}>
            <SecHead name={name} first={i === 0} />
            <div className="cw-card">
              <RefineChoiceRow label={t('admin.creator.structure.format')} value={s.usesRaceFinals ? 'hhf' : 'std'} options={FORMATS} disabled={locked}
                onChange={(v) => update(i, (cur) => setRaceFinals(cur, v === 'hhf'))} />
              <div className="cw-panel" style={{ paddingBlock: 12 }}>
                <div className="cw-line" style={{ alignItems: 'flex-end' }}>
                  <div className="cw-stp-field" style={{ flex: '0 0 auto' }}>
                    <span>{t('admin.creator.structure.sessions')}</span>
                    <Stepper name={t('admin.creator.structure.sessionsFor', { name })} value={String(s.sessions.length)} min={1} max={s.usesRaceFinals || locked ? s.sessions.length : MAX_SESSIONS}
                      onChange={(n) => update(i, (cur) => resizeSessions(cur, n))} />
                  </div>
                  <div className="cw-stp-field" style={{ flex: '0 0 auto' }}>
                    <span>{t('admin.creator.structure.minutesPerHeat')}</span>
                    <Stepper name={t('admin.creator.structure.minutesPerHeatFor', { name })} value={s.minutesPerRace} min={1} max={180} step={5}
                      onChange={(n) => { patch(i, { minutesPerRace: String(n) }); clear(`section.${i}.minutes`); }} />
                  </div>
                </div>
                {minutesError && <p role="alert" className="cw-note" style={{ color: 'rgb(var(--mg-elim))', margin: 0 }}>{minutesError}</p>}
                {s.usesRaceFinals && <p className="cw-t2">{t('admin.creator.structure.hhfNote')}</p>}
              </div>
              {draft.arenas.length > 1 && (
                <RefineChoiceRow label={t('admin.creator.structure.arena')} value={s.arena} options={arenaOptions}
                  onChange={(arena) => { change({ sections: setSectionArena(draft, i, arena) }); clear(`section.${i}.arena`); }} />
              )}
              <span className="cw-subhead">{t('admin.creator.structure.scoringExtras')}</span>
              <RefineChoiceRow label={t('admin.creator.structure.tieBreak')} value={tie} options={TIES} onChange={(v) => patch(i, { tieBreak: parseInt(v, 10) })} />
              {tie === '2' && (
                <RefineChoiceRow label={t('admin.creator.structure.runoff')} value={s.runoffRaceName} options={raceOptions} allowOther placeholder={t('admin.creator.choose')}
                  onChange={(runoffRaceName) => patch(i, { runoffRaceName })} />
              )}
              {!s.usesRaceFinals && (
                <RefineChoiceRow label={t('admin.creator.structure.laneAfter')} value={String(s.laneRotation ?? 0)} options={LANES} disabled={locked}
                  onChange={(v) => patch(i, { laneRotation: parseInt(v, 10) })} />
              )}
              {sectionHasFinal(s) && (
                <>
                  <RefineSwitchRow label={t('admin.creator.structure.carry')} on={s.carryPointsIntoFinal === true} onChange={(on) => patch(i, { carryPointsIntoFinal: on })} />
                  <RefineSwitchRow label={t('admin.creator.structure.double')} on={s.doublePointsInFinal === true} disabled={!!s.finalScored} onChange={(on) => patch(i, { doublePointsInFinal: on })} />
                </>
              )}
            </div>
            {locked && <p className="cw-note">{t('admin.creator.structure.locked')}</p>}
            <p className="cw-note" aria-live="polite">
              {t('admin.creator.structure.estimate', { teams: estimateText(est.teams), heats: s.usesRaceFinals ? t('admin.creator.structure.qualifiers') : describeHeats(est.sizes), duration: durationText(est.minutesPerSession) })}
            </p>
          </div>
        );
      })}
      <HatbandEditor draft={draft} change={change} />
    </section>
  );
}
