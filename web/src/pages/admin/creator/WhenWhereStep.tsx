import { useState } from 'react';
import { MapPinCheck } from 'lucide-react';
import { useT } from '../../../i18n/LanguageContext';
import { api } from '../../../api';
import type { CreatorDraft } from '../../../lib/creatorDraft';
import { Field } from '../../auth/Field';
import { RefineChoiceRow, RefineDateTimeRow } from '../../refine/Refine';
import { StepHeading } from './controls';
import { fieldClass, TextBox, type StepProps } from './parts';

const pad = (n: number) => String(n).padStart(2, '0');

/** A local date and time typed as "2027-04-24" and "09:00" as the ISO time the calendar row wants; null when either is missing. */
function toIso(date: string, time: string): string | null {
  if (!date) return null;
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = (time || '00:00').split(':').map(Number);
  const out = new Date(y, m - 1, d, h || 0, min || 0);
  return Number.isNaN(out.getTime()) ? null : out.toISOString();
}

function fromIso(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/** The days the event runs, for the calendar to ring (at most two weeks). */
function eventDays(draft: CreatorDraft): Date[] {
  if (!draft.startDate) return [];
  const [y, m, d] = draft.startDate.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const [ey, em, ed] = (draft.endDate || draft.startDate).split('-').map(Number);
  const end = new Date(ey, em - 1, ed);
  const days: Date[] = [];
  for (let day = start; day <= end && days.length < 14; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) days.push(day);
  return days;
}

export function WhenWhereStep({ draft, change, problems, clear }: StepProps<CreatorDraft>) {
  const t = useT();
  // The last postcode / what3words pair that was looked up, and how that went.
  const [geo, setGeo] = useState<{ key: string; status: 'ok' | 'none' | 'failed' } | null>(null);
  const geoKey = `${draft.postcode.trim()}|${draft.what3Words.trim()}`;
  const geoNow = geo?.key === geoKey ? geo.status : null;

  /** Looks the postcode / what3words up when the person leaves the field. */
  async function lookUp() {
    if (geoKey === '|' || (geo?.key === geoKey && geo.status === 'ok')) return;
    try {
      const { data } = await api.get<{ latitude: number | null; longitude: number | null; source: string | null }>(
        '/geocode', { params: { postcode: draft.postcode.trim() || undefined, w3w: draft.what3Words.trim() || undefined } });
      if (data.latitude != null && data.longitude != null) {
        change({ lat: String(data.latitude), lon: String(data.longitude) });
        setGeo({ key: geoKey, status: 'ok' });
      } else setGeo({ key: geoKey, status: 'none' });
    } catch {
      setGeo({ key: geoKey, status: 'failed' });
    }
  }

  return (
    <section aria-label={t('admin.creator.step.when')} className="flex flex-col">
      <StepHeading>{t('admin.creator.step.when')}</StepHeading>
      <div className="cw-card mt-3">
        <RefineDateTimeRow label={t('admin.creator.when.starts')} value={toIso(draft.startDate, draft.startTime)} removable={false} eventDays={eventDays(draft)}
          onChange={(iso) => { if (!iso) return; const { date, time } = fromIso(iso); change({ startDate: date, startTime: time }); clear('startDate'); clear('startTime'); }} />
        <RefineDateTimeRow label={t('admin.creator.when.ends')} value={toIso(draft.endDate, draft.endTime)} eventDays={eventDays(draft)}
          onChange={(iso) => { if (!iso) { change({ endDate: '' }); clear('endDate'); return; } const { date, time } = fromIso(iso); change({ endDate: date, endTime: time }); clear('endDate'); }} />
      </div>
      {(problems.startDate || problems.startTime || problems.endDate) && (
        <p role="alert" aria-invalid="true" tabIndex={-1} className="cw-note" style={{ color: 'rgb(var(--mg-elim))' }}>{problems.startDate || problems.startTime || problems.endDate}</p>
      )}
      {!draft.endDate && <p className="cw-note">{t('admin.creator.when.noEnd')}</p>}

      <div className="cw-card mt-4">
        <div className="cw-panel cw-panel-roomy">
          <TextBox label={t('admin.creator.when.venue')} value={draft.location} onChange={(location) => change({ location })} />
          <div className="cw-line">
            <Field label={t('admin.creator.when.postcode')} error={geoNow === 'none' ? t('admin.creator.when.geoNone') : geoNow === 'failed' ? t('admin.creator.when.geoFailed') : null} className="sm:max-w-[200px]">
              {({ id, invalid, describedBy }) => (
                <div className={fieldClass} data-invalid={invalid}>
                  <input id={id} value={draft.postcode} autoComplete="postal-code" aria-invalid={invalid} aria-describedby={describedBy}
                    className="uppercase" onChange={(e) => change({ postcode: e.target.value })} onBlur={() => void lookUp()} />
                  {geoNow === 'ok' && <MapPinCheck aria-label={t('admin.creator.when.geoFound')} role="img" className="h-[18px] w-[18px] shrink-0 text-[rgb(var(--mg-heading))]" />}
                </div>
              )}
            </Field>
            <Field label={<>{t('admin.creator.when.what3words')} <span className="font-normal text-[rgb(var(--mg-muted))]">{t('admin.creator.optional')}</span></>}>
              {({ id }) => (
                <div className={fieldClass}>
                  <input id={id} value={draft.what3Words} placeholder={t('admin.creator.when.what3wordsPlaceholder')} autoComplete="off"
                    onChange={(e) => change({ what3Words: e.target.value })} onBlur={() => void lookUp()} />
                </div>
              )}
            </Field>
          </div>
          <div className="cw-line">
            <TextBox label={<>{t('admin.creator.when.number')} <span className="font-normal text-[rgb(var(--mg-muted))]">{t('admin.creator.optional')}</span></>} value={draft.competitionNumber}
              onChange={(competitionNumber) => change({ competitionNumber })} />
            <TextBox label={<>{t('admin.creator.when.email')} <span className="font-normal text-[rgb(var(--mg-muted))]">{t('admin.creator.optional')}</span></>} value={draft.contactEmail} autoComplete="email"
              error={problems.contactEmail} onChange={(contactEmail) => { change({ contactEmail }); clear('contactEmail'); }} hint={t('admin.creator.when.emailHint')} />
          </div>
        </div>
        <RefineChoiceRow
          label={t('admin.creator.when.setting')}
          value={draft.isIndoor ? 'indoor' : 'outdoor'}
          options={[
            { value: 'outdoor', label: t('admin.creator.when.outdoor') },
            { value: 'indoor', label: t('admin.creator.when.indoor') },
          ]}
          onChange={(v) => change({ isIndoor: v === 'indoor' })}
        />
      </div>
    </section>
  );
}
