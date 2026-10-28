import { useMemo } from 'react';
import { Trash2 } from 'lucide-react';
import { useT } from '../../../i18n/LanguageContext';
import { competitionIcon } from '../../../competition/icons';
import { competitionDateText } from '../../../lib/competitionDates';
import {
  arenaOf, hatbandsFor, lanesOfArena, parseFinalistCount, priceGbpToMinor, sectionHasFinal, sectionName, type CreatorDraft, type StepId,
} from '../../../lib/creatorDraft';
import { raceLists } from '../../../lib/creatorRaces';
import { provisionalTimetable } from '../../../lib/creatorPlan';
import type { FixedItem } from '../../../lib/formatPlan';
import { formatTime } from '../../../lib/time';
import { hatbandColour, hatbandName } from '../../../lib/hatbands';
import { Notice } from '../../../components/Notice';
import { BreakForm } from './BreakForm';
import { SmallHead, StepHeading } from './controls';
import type { StepProps } from './parts';

const pounds = (pence: number) => `£${(pence / 100).toFixed(2).replace(/\.00$/, '')}`;

function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  const t = useT();
  return <button type="button" className="cw-btn cw-btn-s" aria-label={t('admin.creator.review.editAria', { label })} onClick={onClick}>{t('common.edit')}</button>;
}

/** The last look: each part of what will be created, with a button to go back and change it. */
export function ReviewStep({ draft, change, problems, teamCounts, real, onEdit, payoutsText, isEdit }: StepProps<CreatorDraft> & {
  teamCounts: Readonly<Record<number, number>>;
  real: readonly FixedItem[];
  onEdit: (step: StepId) => void;
  /** The one line about where entry fees go, as shown on the payment step. */
  payoutsText: string;
  isEdit: boolean;
}) {
  const t = useT();
  const money = (pence: number) => (pence === 0 ? t('admin.creator.review.free') : pounds(pence));
  const plan = useMemo(() => provisionalTimetable(draft, teamCounts, real), [draft, teamCounts, real]);
  const arenas = draft.arenas.map((a) => a.name.trim()).filter(Boolean);
  const unchosen = draft.sections.flatMap((s) => s.sessions.filter((x) => x.races === null && !x.hasHeats)).length;
  const iso = (date: string, time: string) => { const d = new Date(`${date}T${time}`); return Number.isNaN(d.getTime()) ? '' : d.toISOString(); };
  const when = competitionDateText(iso(draft.startDate, draft.startTime || '09:00'), draft.endDate ? iso(draft.endDate, draft.endTime || '17:00') : null);
  const hatbands = hatbandsFor(draft);
  const icon = competitionIcon(draft.icon);

  return (
    <section aria-label={t('admin.creator.step.review')} className="flex flex-col">
      <StepHeading>{t('admin.creator.step.review')}</StepHeading>

      <SmallHead aside={<EditButton label={t('admin.creator.step.about')} onClick={() => onEdit('about')} />}>{t('admin.creator.step.about')}</SmallHead>
      <div className="cw-card"><div className="cw-rv"><span className="cw-grow">
        <span className="cw-t1">{draft.name.trim() || t('admin.creator.review.untitled')}</span>
        <span className="cw-t2">{[draft.organiserName.trim(), icon.label].filter(Boolean).join(' · ')}</span>
      </span></div></div>

      <SmallHead aside={<EditButton label={t('admin.creator.step.when')} onClick={() => onEdit('when')} />}>{t('admin.creator.step.when')}</SmallHead>
      <div className="cw-card"><div className="cw-rv"><span className="cw-grow">
        <span className="cw-t1">{draft.startDate ? [when, draft.startTime && t('admin.creator.review.fromTime', { time: draft.startTime })].filter(Boolean).join(' · ') : t('admin.creator.review.datesToSet')}</span>
        <span className="cw-t2">{[draft.location.trim(), draft.postcode.trim(), draft.what3Words.trim() && `///${draft.what3Words.trim().replace(/^\/+/, '')}`].filter(Boolean).join(', ') || t('admin.creator.review.noVenue')}</span>
      </span></div></div>

      <SmallHead aside={<EditButton label={t('admin.creator.step.arenas')} onClick={() => onEdit('arenas')} />}>{t('admin.creator.step.arenas')}</SmallHead>
      <div className="cw-card">
        {draft.arenas.map((a, i) => (
          <div key={i} className="cw-rv"><span className="cw-grow"><span className="cw-t1">{a.name}</span><span className="cw-t2">{t('admin.creator.review.lanes', { count: lanesOfArena(a) })}</span></span></div>
        ))}
      </div>

      <SmallHead aside={<EditButton label={t('admin.creator.step.sections')} onClick={() => onEdit('sections')} />}>{t('admin.creator.step.sections')}</SmallHead>
      <div className="cw-card">
        {draft.sections.map((s, i) => {
          const lists = raceLists(s);
          const finalists = parseFinalistCount(s.finalistCount);
          return (
            <div key={s.existingId ?? `new-${i}`} className="cw-rv">
              <span className="cw-grow">
                <span className="cw-t1">{sectionName(s)}</span>
                <span className="cw-t2">{[t(`admin.creator.format.${s.format}`), money(priceGbpToMinor(s.priceGbp)), s.maxParticipants ? t('admin.creator.review.upTo', { count: parseInt(s.maxParticipants, 10) }) : t('admin.creator.review.noLimit')].join(' · ')}</span>
                <span className="cw-t2">
                  {[s.usesRaceFinals ? t('admin.creator.review.hhf') : t('admin.creator.review.standard'), t('admin.creator.review.sessions', { count: s.sessions.length }), t('admin.creator.review.minAHeat', { minutes: s.minutesPerRace }), draft.arenas.length > 1 ? arenaOf(draft, s).name : '',
                    sectionHasFinal(s) && finalists ? t('admin.creator.review.throughToFinal', { count: finalists }) : ''].filter(Boolean).join(' · ')}
                </span>
                <span className="cw-t2">
                  {[t('admin.creator.review.tie', { rule: t(`admin.creator.review.tie.${(s.tieBreak ?? 0) as 0 | 1 | 2 | 3}` as const) }), s.usesRaceFinals ? t('admin.creator.review.randomLanes') : t(`admin.creator.review.lanesRule.${(s.laneRotation ?? 0) as 0 | 1 | 2}` as const),
                    sectionHasFinal(s) && s.carryPointsIntoFinal ? t('admin.creator.review.carried') : '', sectionHasFinal(s) && s.doublePointsInFinal ? t('admin.creator.review.double') : ''].filter(Boolean).join(' · ')}
                </span>
                {lists.map((l) => (
                  <span key={String(l.key)} className="cw-rv-chips">
                    <span className="cw-t1">{l.label}</span>
                    {l.same && <span className="cw-t2">{t('admin.creator.review.sameAsFirst')}</span>}
                    {!l.same && !l.races && <span className="cw-t2">{t('admin.creator.review.chooseLater')}</span>}
                    {!l.same && l.races?.map((r, n) => <span key={r} className="cw-chip">{n + 1}. {r}</span>)}
                  </span>
                ))}
              </span>
              <button type="button" className="cw-btn cw-btn-s" aria-label={t('admin.creator.review.editRacesAria', { name: sectionName(s) })} onClick={() => onEdit('races')}>{t('admin.creator.review.editRaces')}</button>
            </div>
          );
        })}
      </div>

      <SmallHead aside={<EditButton label={t('admin.creator.hat.heading')} onClick={() => onEdit('structure')} />}>{t('admin.creator.hat.heading')}</SmallHead>
      <div className="cw-card"><div className="cw-rv" style={{ flexWrap: 'wrap' }}>
        {hatbands.map((h, i) => (
          <span key={i} className="cw-chip cw-chip-lg"><span className="cw-dot" aria-hidden="true" style={{ width: 18, height: 18, background: hatbandColour(h) }} />{i + 1} {hatbandName(h)}</span>
        ))}
        {hatbands.length === 0 && <span className="cw-t2">{t('admin.creator.hat.none')}</span>}
      </div></div>

      <SmallHead aside={<EditButton label={t('admin.creator.step.dec')} onClick={() => onEdit('dec')} />}>{t('admin.creator.step.dec')}</SmallHead>
      <div className="cw-card"><div className="cw-rv"><span className="cw-grow">
        <span className="cw-t2">{isEdit ? t('admin.creator.review.decEdit') : t('admin.creator.review.decNew')}</span>
      </span></div></div>

      <SmallHead aside={<EditButton label={t('admin.creator.step.payment')} onClick={() => onEdit('payment')} />}>{t('admin.creator.step.payment')}</SmallHead>
      <div className="cw-card">
        <div className="cw-rv"><span className="cw-grow"><span className="cw-t1">{payoutsText}</span>
          <span className="cw-t2">{[draft.paymentDestination.trim() ? t('admin.creator.review.pay', { destination: draft.paymentDestination.trim() }) : t('admin.creator.review.payNotSet'), draft.description.trim() ? t('admin.creator.review.notesAdded') : t('admin.creator.review.noNotes')].join(' · ')}</span></span></div>
        <div className="cw-rv"><span className="cw-grow"><span className="cw-t1">
          {[draft.cardsEnabled ? t('admin.creator.pay.cards') : t('admin.creator.review.noCards'), draft.passportCheck ? t('admin.creator.review.passportCheck') : t('admin.creator.review.noPassportCheck')].join(' · ')}
        </span></span></div>
      </div>

      <SmallHead>{t('admin.creator.review.breaksHeading')}</SmallHead>
      {plan.overrun && plan.finishes && (
        <div style={{ marginBottom: 8 }}>
          <Notice>
            {t('admin.creator.review.overrun', { finish: formatTime(plan.finishes), end: draft.endTime || '17:00' })}
          </Notice>
        </div>
      )}
      {unchosen > 0 && <p className="cw-note" style={{ marginTop: 0 }}>{t('admin.creator.review.unchosen', { count: unchosen })}</p>}
      <div className="cw-card">
        {draft.breaks.length === 0 && <div className="cw-row"><span className="cw-t2">{t('admin.creator.review.noBreaks')}</span></div>}
        {draft.breaks.map((b, i) => {
          const bad = Object.keys(problems).some((k) => k.startsWith(`break.${i}.`));
          return (
            <div key={b.existingId ?? `new-${i}`} className="cw-row">
              <span className="cw-grow">
                <span className="cw-t1">{b.name || (b.kind === 2 ? t('admin.creator.break.briefing') : t('admin.creator.break.break'))}</span>
                <span className="cw-t2" style={bad ? { color: 'rgb(var(--mg-elim))' } : undefined}>{[b.kind === 2 ? t('admin.creator.break.briefing') : t('admin.creator.break.break'), b.date, b.time, b.arena || t('admin.creator.break.everyone')].join(' · ')}</span>
              </span>
              <span className="cw-t2">{t('admin.creator.minutesShort', { minutes: b.minutes })}</span>
              <button type="button" className="cw-ib" aria-label={t('admin.creator.review.removeAria', { name: b.name || t('admin.creator.break.breakLower') })} onClick={() => change({ breaks: draft.breaks.filter((_, idx) => idx !== i) })}><Trash2 className="h-[18px] w-[18px]" aria-hidden="true" /></button>
            </div>
          );
        })}
        <BreakForm date={draft.startDate} arenas={arenas} onAdd={(b) => change({ breaks: [...draft.breaks, b] })} />
      </div>
    </section>
  );
}
