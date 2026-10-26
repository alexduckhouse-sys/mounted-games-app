import { useMemo } from 'react';
import { Trash2 } from 'lucide-react';
import { competitionIcon } from '../../../competition/icons';
import { competitionDateText } from '../../../lib/competitionDates';
import {
  arenaOf, FORMAT_LABEL, hatbandsFor, lanesOfArena, parseFinalistCount, priceGbpToMinor, sectionHasFinal, sectionName, type CreatorDraft, type StepId,
} from '../../../lib/creatorDraft';
import { raceLists } from '../../../lib/creatorRaces';
import { provisionalTimetable } from '../../../lib/creatorPlan';
import type { FixedItem } from '../../../lib/formatPlan';
import { formatTime } from '../../../lib/time';
import { hatbandColour, hatbandName } from '../../../lib/hatbands';
import { BreakForm } from './BreakForm';
import { SmallHead, StepHeading } from './controls';
import type { StepProps } from './parts';

const money = (pence: number) => (pence === 0 ? 'Free' : `£${(pence / 100).toFixed(2).replace(/\.00$/, '')}`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const entries = (n: number) => (n === 1 ? '1 entry' : `${n} entries`);
const TIE = ['Countback', 'Last race', 'Run-off', 'Decide on the day'];
const LANE = ['moving up one', 'staying in lane', 'moving down one'];

function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="cw-btn cw-btn-s" aria-label={`Edit ${label}`} onClick={onClick}>Edit</button>;
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
  const plan = useMemo(() => provisionalTimetable(draft, teamCounts, real), [draft, teamCounts, real]);
  const arenas = draft.arenas.map((a) => a.name.trim()).filter(Boolean);
  const unchosen = draft.sections.flatMap((s) => s.sessions.filter((x) => x.races === null && !x.hasHeats)).length;
  const iso = (date: string, time: string) => { const d = new Date(`${date}T${time}`); return Number.isNaN(d.getTime()) ? '' : d.toISOString(); };
  const when = competitionDateText(iso(draft.startDate, draft.startTime || '09:00'), draft.endDate ? iso(draft.endDate, draft.endTime || '17:00') : null);
  const hatbands = hatbandsFor(draft);
  const icon = competitionIcon(draft.icon);

  return (
    <section aria-label="Review" className="flex flex-col">
      <StepHeading>Review</StepHeading>

      <SmallHead aside={<EditButton label="About" onClick={() => onEdit('about')} />}>About</SmallHead>
      <div className="cw-card"><div className="cw-rv"><span className="cw-grow">
        <span className="cw-t1">{draft.name.trim() || 'Untitled competition'}</span>
        <span className="cw-t2">{[draft.organiserName.trim(), icon.label].filter(Boolean).join(' · ')}</span>
      </span></div></div>

      <SmallHead aside={<EditButton label="When and where" onClick={() => onEdit('when')} />}>When and where</SmallHead>
      <div className="cw-card"><div className="cw-rv"><span className="cw-grow">
        <span className="cw-t1">{draft.startDate ? [when, draft.startTime && `from ${draft.startTime}`].filter(Boolean).join(' · ') : 'Dates to set'}</span>
        <span className="cw-t2">{[draft.location.trim(), draft.postcode.trim(), draft.what3Words.trim() && `///${draft.what3Words.trim().replace(/^\/+/, '')}`].filter(Boolean).join(', ') || 'No venue yet'}</span>
      </span></div></div>

      <SmallHead aside={<EditButton label="Arenas" onClick={() => onEdit('arenas')} />}>Arenas</SmallHead>
      <div className="cw-card">
        {draft.arenas.map((a, i) => (
          <div key={i} className="cw-rv"><span className="cw-grow"><span className="cw-t1">{a.name}</span><span className="cw-t2">{plural(lanesOfArena(a), 'lane')}</span></span></div>
        ))}
      </div>

      <SmallHead aside={<EditButton label="Sections" onClick={() => onEdit('sections')} />}>Sections</SmallHead>
      <div className="cw-card">
        {draft.sections.map((s, i) => {
          const lists = raceLists(s);
          const finalists = parseFinalistCount(s.finalistCount);
          return (
            <div key={s.existingId ?? `new-${i}`} className="cw-rv">
              <span className="cw-grow">
                <span className="cw-t1">{sectionName(s)}</span>
                <span className="cw-t2">{[FORMAT_LABEL[s.format], money(priceGbpToMinor(s.priceGbp)), s.maxParticipants ? `up to ${entries(parseInt(s.maxParticipants, 10))}` : 'no entry limit'].join(' · ')}</span>
                <span className="cw-t2">
                  {[s.usesRaceFinals ? 'Heat, heat, final' : 'Standard', plural(s.sessions.length, 'session'), `${s.minutesPerRace} min a heat`, draft.arenas.length > 1 ? arenaOf(draft, s).name : '',
                    sectionHasFinal(s) && finalists ? `${finalists} through to the final` : ''].filter(Boolean).join(' · ')}
                </span>
                <span className="cw-t2">
                  {[`Tie-break: ${TIE[s.tieBreak ?? 0].toLowerCase()}`, s.usesRaceFinals ? 'random lanes' : `lanes ${LANE[s.laneRotation ?? 0]}`,
                    sectionHasFinal(s) && s.carryPointsIntoFinal ? 'points carried into the final' : '', sectionHasFinal(s) && s.doublePointsInFinal ? 'double points in the final' : ''].filter(Boolean).join(' · ')}
                </span>
                {lists.map((l) => (
                  <span key={String(l.key)} className="cw-rv-chips">
                    <span className="cw-t1">{l.label}</span>
                    {l.same && <span className="cw-t2">Same as Session 1</span>}
                    {!l.same && !l.races && <span className="cw-t2">Races to be chosen later</span>}
                    {!l.same && l.races?.map((r, n) => <span key={r} className="cw-chip">{n + 1}. {r}</span>)}
                  </span>
                ))}
              </span>
              <button type="button" className="cw-btn cw-btn-s" aria-label={`Edit races for ${sectionName(s)}`} onClick={() => onEdit('races')}>Edit races</button>
            </div>
          );
        })}
      </div>

      <SmallHead aside={<EditButton label="Hatbands" onClick={() => onEdit('structure')} />}>Hatbands</SmallHead>
      <div className="cw-card"><div className="cw-rv" style={{ flexWrap: 'wrap' }}>
        {hatbands.map((h, i) => (
          <span key={i} className="cw-chip cw-chip-lg"><span className="cw-dot" aria-hidden="true" style={{ width: 18, height: 18, background: hatbandColour(h) }} />{i + 1} {hatbandName(h)}</span>
        ))}
        {hatbands.length === 0 && <span className="cw-t2">No hatbands</span>}
      </div></div>

      <SmallHead aside={<EditButton label="Dec form" onClick={() => onEdit('dec')} />}>Dec form</SmallHead>
      <div className="cw-card"><div className="cw-rv"><span className="cw-grow">
        <span className="cw-t2">{isEdit ? 'Set up on the dec form page of this competition.' : 'The basics: rider, pony, trainer name and phone. Add more once it’s created.'}</span>
      </span></div></div>

      <SmallHead aside={<EditButton label="Payment and rules" onClick={() => onEdit('payment')} />}>Payment and rules</SmallHead>
      <div className="cw-card">
        <div className="cw-rv"><span className="cw-grow"><span className="cw-t1">{payoutsText}</span>
          <span className="cw-t2">{[draft.paymentDestination.trim() ? `Pay: ${draft.paymentDestination.trim()}` : 'How to pay not set', draft.description.trim() ? 'Notes added' : 'No notes'].join(' · ')}</span></span></div>
        <div className="cw-rv"><span className="cw-grow"><span className="cw-t1">
          {[draft.cardsEnabled ? 'Yellow and red cards' : 'No cards', draft.passportCheck ? 'passport check' : 'no passport check'].join(' · ')}
        </span></span></div>
      </div>

      <SmallHead>Breaks and briefings</SmallHead>
      {plan.overrun && plan.finishes && (
        <p role="alert" className="mg-notice !bg-[rgb(var(--mg-live-row))] !text-[rgb(var(--mg-elim))]" style={{ marginBottom: 8 }}>
          The timetable runs until {formatTime(plan.finishes)}, after the end time you gave. Shorten the races, add an arena or move the end time.
        </p>
      )}
      {unchosen > 0 && <p className="cw-note" style={{ marginTop: 0 }}>Races aren’t chosen for {plural(unchosen, 'session')}. That’s fine: the times use the standard list, and you can set them any time before the day.</p>}
      <div className="cw-card">
        {draft.breaks.length === 0 && <div className="cw-row"><span className="cw-t2">None yet. Add a lunch break or a riders’ briefing and the timetable works around it.</span></div>}
        {draft.breaks.map((b, i) => {
          const bad = Object.keys(problems).some((k) => k.startsWith(`break.${i}.`));
          return (
            <div key={b.existingId ?? `new-${i}`} className="cw-row">
              <span className="cw-grow">
                <span className="cw-t1">{b.name || (b.kind === 2 ? 'Briefing' : 'Break')}</span>
                <span className="cw-t2" style={bad ? { color: 'rgb(var(--mg-elim))' } : undefined}>{[b.kind === 2 ? 'Briefing' : 'Break', b.date, b.time, b.arena || 'Everyone'].join(' · ')}</span>
              </span>
              <span className="cw-t2">{b.minutes} min</span>
              <button type="button" className="cw-ib" aria-label={`Remove ${b.name || 'break'}`} onClick={() => change({ breaks: draft.breaks.filter((_, idx) => idx !== i) })}><Trash2 className="h-[18px] w-[18px]" aria-hidden="true" /></button>
            </div>
          );
        })}
        <BreakForm date={draft.startDate} arenas={arenas} onAdd={(b) => change({ breaks: [...draft.breaks, b] })} />
      </div>
    </section>
  );
}
