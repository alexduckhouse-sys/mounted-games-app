import { useMemo } from 'react';
import { Trash2 } from 'lucide-react';
import { competitionDateText } from '../../../lib/competitionDates';
import { hatbandsFor, parseFinalistCount, priceGbpToMinor, sectionName, type CreatorDraft } from '../../../lib/creatorDraft';
import { durationText, plannedSessions, provisionalTimetable } from '../../../lib/creatorPlan';
import type { FixedItem } from '../../../lib/formatPlan';
import { formatTime } from '../../../lib/time';
import { BreakForm } from './BreakForm';
import { HatbandList } from './Hatbands';
import { Pill, StepIntro, type StepProps } from './parts';

const money = (pence: number) => (pence === 0 ? 'Free' : `£${(pence / 100).toFixed(2)}`);

/** The last look: what will be created, the provisional timetable, and breaks and briefings to put in it. */
export function ReviewStep({ draft, change, problems, teamCounts, real }: StepProps<CreatorDraft> & {
  teamCounts: Readonly<Record<number, number>>;
  real: readonly FixedItem[];
}) {
  const plan = useMemo(() => provisionalTimetable(draft, teamCounts, real), [draft, teamCounts, real]);
  const planned = useMemo(() => plannedSessions(draft, teamCounts), [draft, teamCounts]);
  const arenas = [...new Set(draft.sections.map((s) => s.arena.trim()).filter(Boolean))];
  const unchosen = draft.sections.flatMap((s) => s.sessions.filter((x) => x.races === null && !x.hasHeats)).length;
  const basis = new Set(planned.map((p) => p.teams.basis));
  const iso = (date: string, time: string) => { const d = new Date(`${date}T${time}`); return Number.isNaN(d.getTime()) ? '' : d.toISOString(); };
  const when = competitionDateText(iso(draft.startDate, draft.startTime || '09:00'), draft.endDate ? iso(draft.endDate, draft.endTime || '17:00') : null);

  return (
    <section aria-labelledby="cw-review" className="flex flex-col gap-[18px]">
      <StepIntro title="Review">Check it over. You can go back to any step, and change everything later.</StepIntro>

      <div className="mg-card flex flex-col gap-1 p-4">
        <strong className="text-[19px] text-[rgb(var(--mg-heading))]">{draft.name.trim() || 'Untitled competition'}</strong>
        <span className="text-sm text-[rgb(var(--mg-muted))]">{[when, draft.startTime && `from ${draft.startTime}`, draft.location.trim()].filter(Boolean).join(' · ')}</span>
      </div>

      <ul className="mg-card mg-list" aria-label="Age groups">
        {draft.sections.map((s, i) => (
          <li key={i} className="flex flex-col gap-0.5 px-4 py-3">
            <strong className="text-[15px]">{sectionName(s)}</strong>
            <span className="text-xs text-[rgb(var(--mg-muted))]">
              {[
                money(priceGbpToMinor(s.priceGbp)),
                s.maxParticipants ? `max ${s.maxParticipants} entries` : 'no entry limit',
                s.usesRaceFinals ? 'heat, heat, final' : `${s.sessions.length} ${s.sessions.length === 1 ? 'session' : 'sessions'}`,
                parseFinalistCount(s.finalistCount) ? `${parseFinalistCount(s.finalistCount)} through to the final` : '',
                `${s.minutesPerRace} min per race`, `up to ${s.maxTeamsPerHeat} per heat`, s.arena,
              ].filter(Boolean).join(' · ')}
            </span>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-2">
        <strong className="text-[15px]">Hatbands</strong>
        <HatbandList hatbands={hatbandsFor(draft)} />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3 border-b-2 border-[rgb(var(--mg-heading))] pb-2">
          <h3 id="cw-timetable" className="mg-display flex-1 text-[22px] font-bold uppercase leading-none tracking-[0.03em] text-[rgb(var(--mg-heading))]">Timetable</h3>
          <Pill tone="provisional">Provisional</Pill>
        </div>
        <p className="text-sm text-[rgb(var(--mg-muted))]">
          An estimate from the structure above{basis.has('guess') ? ', with a guess at how many teams will enter where there is no entry limit' : ''}.
          It becomes exact once teams are formed and the races are set.
        </p>
        {plan.overrun && plan.finishes && (
          <p role="alert" className="mg-notice !bg-[rgb(var(--mg-live-row))] !text-[rgb(var(--mg-elim))]">
            This runs until {formatTime(plan.finishes)}, after the end time you gave. Shorten the races, add an arena or move the end time.
          </p>
        )}
        {unchosen > 0 && <p className="mg-notice">Races aren’t chosen for {unchosen} {unchosen === 1 ? 'session' : 'sessions'}. That’s fine: the times use the standard list, and you can set them any time before the day.</p>}
        <ul className="mg-card mg-list" aria-label="Provisional timetable">
          {plan.rows.length === 0 && <li className="p-4 text-sm text-[rgb(var(--mg-muted))]">Nothing to schedule yet.</li>}
          {plan.rows.map((row, i) => (
            <li key={`${row.kind}-${i}`} className="grid min-h-14 grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 py-1 pl-4 pr-3">
              <span className="mg-line-time">{row.minutes > 0 ? formatTime(row.start) : '–'}</span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <strong className="truncate text-[15px] font-semibold">{row.name}{row.kind === 'break' ? ' (break)' : row.kind === 'briefing' ? ' (briefing)' : ''}</strong>
                <span className="text-xs text-[rgb(var(--mg-muted))]">{[row.arena || (row.kind === 'session' ? '' : 'Everyone'), row.detail].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="text-[13px] text-[rgb(var(--mg-muted))]">{row.minutes > 0 ? durationText(row.minutes) : ''}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3 border-b-2 border-[rgb(var(--mg-heading))] pb-2">
          <h3 id="cw-breaks" className="mg-display flex-1 text-[22px] font-bold uppercase leading-none tracking-[0.03em] text-[rgb(var(--mg-heading))]">Breaks and briefings</h3>
        </div>
        <div className="mg-card overflow-hidden">
          {draft.breaks.length === 0 && <p className="px-4 py-3 text-sm text-[rgb(var(--mg-muted))]">None yet. Add a lunch break or a riders’ briefing and the timetable works around it.</p>}
          <ul>
            {draft.breaks.map((b, i) => {
              const bad = Object.keys(problems).some((k) => k.startsWith(`break.${i}.`));
              return (
                <li key={b.existingId ?? `new-${i}`} className={`grid min-h-14 grid-cols-[64px_minmax(0,1fr)_auto_40px] items-center gap-3 py-1 pl-4 pr-3 ${i ? 'border-t border-[rgb(var(--mg-rule-soft))]' : ''}`}>
                  <span className="mg-line-time">{b.time}</span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <strong className="truncate text-[15px] font-semibold">{b.name || (b.kind === 2 ? 'Briefing' : 'Break')}</strong>
                    <span className={`text-xs ${bad ? 'text-[rgb(var(--mg-elim))]' : 'text-[rgb(var(--mg-muted))]'}`}>{[b.kind === 2 ? 'Briefing' : 'Break', b.date, b.arena || 'Everyone'].join(' · ')}</span>
                  </span>
                  <span className="text-[13px] text-[rgb(var(--mg-muted))]">{b.minutes} min</span>
                  <button type="button" aria-label={`Remove ${b.name || 'break'}`} onClick={() => change({ breaks: draft.breaks.filter((_, idx) => idx !== i) })}
                    className="flex h-11 w-10 items-center justify-center text-[rgb(var(--mg-muted))]"><Trash2 className="h-[18px] w-[18px]" aria-hidden="true" /></button>
                </li>
              );
            })}
          </ul>
          <BreakForm date={draft.startDate} arenas={arenas} onAdd={(b) => change({ breaks: [...draft.breaks, b] })} />
        </div>
      </div>
    </section>
  );
}
