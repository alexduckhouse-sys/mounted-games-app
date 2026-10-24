import { useState } from 'react';
import { CalendarDays, MapPinCheck } from 'lucide-react';
import { api } from '../../../api';
import type { CreatorDraft } from '../../../lib/creatorDraft';
import { Field } from '../../auth/Field';
import { fieldClass, StepIntro, TextBox, type StepProps } from './parts';

export function WhenWhereStep({ draft, change, problems, clear }: StepProps<CreatorDraft>) {
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
    <section aria-labelledby="cw-when" className="flex flex-col gap-[18px]">
      <StepIntro title="When and where" />
      <div className="grid grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] gap-2.5 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)] sm:gap-4">
        <Field label="Starts" error={problems.startDate}>
          {({ id, invalid, describedBy }) => (
            <div className={fieldClass} data-invalid={invalid}>
              <CalendarDays aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-[rgb(var(--mg-heading))]" />
              <input id={id} type="date" value={draft.startDate} aria-invalid={invalid} aria-describedby={describedBy}
                onChange={(e) => { change({ startDate: e.target.value }); clear('startDate'); }} />
            </div>
          )}
        </Field>
        <Field label="at" error={problems.startTime}>
          {({ id, invalid, describedBy }) => (
            <div className={fieldClass} data-invalid={invalid}>
              <input id={id} type="time" value={draft.startTime} aria-label="Start time" aria-invalid={invalid} aria-describedby={describedBy}
                onChange={(e) => { change({ startTime: e.target.value }); clear('startTime'); }} />
            </div>
          )}
        </Field>
        <Field label="Ends" error={problems.endDate}>
          {({ id, invalid, describedBy }) => (
            <div className={`${fieldClass} relative`} data-invalid={invalid}>
              <CalendarDays aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-[rgb(var(--mg-heading))]" />
              <input id={id} type="date" value={draft.endDate} aria-invalid={invalid} aria-describedby={describedBy}
                onChange={(e) => { change({ endDate: e.target.value }); clear('endDate'); }}
                className={`peer ${draft.endDate ? '' : '[&::-webkit-datetime-edit]:opacity-0 focus:[&::-webkit-datetime-edit]:opacity-100'}`} />
              {!draft.endDate && <span aria-hidden="true" className="pointer-events-none absolute left-[42px] text-base text-[rgb(var(--mg-faint))] peer-focus:hidden">Same day</span>}
            </div>
          )}
        </Field>
        <Field label="at">
          {({ id }) => (
            <div className={fieldClass}><input id={id} type="time" value={draft.endTime} aria-label="End time" onChange={(e) => change({ endTime: e.target.value })} /></div>
          )}
        </Field>
      </div>
      <TextBox label="Venue" value={draft.location} onChange={(location) => change({ location })} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Postcode" error={geoNow === 'none' ? 'No location found for that.' : geoNow === 'failed' ? 'Could not look that up.' : null}>
          {({ id, invalid, describedBy }) => (
            <div className={fieldClass} data-invalid={invalid}>
              <input id={id} value={draft.postcode} autoComplete="postal-code" aria-invalid={invalid} aria-describedby={describedBy}
                className="uppercase" onChange={(e) => change({ postcode: e.target.value })} onBlur={() => void lookUp()} />
              {geoNow === 'ok' && <MapPinCheck aria-label="Location found" role="img" className="h-[18px] w-[18px] shrink-0 text-[rgb(var(--mg-heading))]" />}
            </div>
          )}
        </Field>
        <Field label={<>what3words <span className="font-normal text-[rgb(var(--mg-muted))]">(optional)</span></>}>
          {({ id }) => (
            <div className={fieldClass}>
              <input id={id} value={draft.what3Words} placeholder="///filled.count.soap" autoComplete="off"
                onChange={(e) => change({ what3Words: e.target.value })} onBlur={() => void lookUp()} />
            </div>
          )}
        </Field>
      </div>
    </section>
  );
}
