import { useState, type FormEvent } from 'react';
import { SectionFormatLabel, type SectionFormat } from '../../types';
import { seasonError, type SeasonSettings } from './seasonViewTypes';

const initial: SeasonSettings = {
  title: '', year: new Date().getFullYear(), format: 2, ageGroup: '',
  bestResultsToCount: null, placePoints: [10, 8, 6, 4, 2, 1].map((points, i) => ({ place: i + 1, points })),
};

export function SeasonSettingsForm({ value = initial, onSave, onCancel, label = 'Save settings' }: {
  value?: SeasonSettings;
  onSave: (settings: SeasonSettings) => Promise<void>;
  onCancel: () => void;
  label?: string;
}) {
  const [draft, setDraft] = useState<SeasonSettings>({
    title: value.title, year: value.year, format: value.format, ageGroup: value.ageGroup,
    bestResultsToCount: value.bestResultsToCount, placePoints: value.placePoints,
  });
  const [points, setPoints] = useState(value.placePoints.map((rule) => rule.points).join(', '));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    const values = points.trim().split(/[\s,]+/).map(Number);
    if (!points.trim() || values.length > 100 || values.some((n, i) => !Number.isSafeInteger(n) || n < 0 || n > 1000000 || (i > 0 && n > values[i - 1]))) {
      setError('Enter points from first place downwards, separated by commas. Use whole numbers from 0 to 1,000,000, with no increase for a lower place.');
      return;
    }
    setBusy(true); setError('');
    try {
      await onSave({ ...draft, title: draft.title.trim(), ageGroup: draft.ageGroup.trim(), placePoints: values.map((n, i) => ({ place: i + 1, points: n })) });
    } catch (reason) { setError(seasonError(reason, 'The season couldn’t be saved. Check your connection and try again.')); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="season-form">
    {error && <p role="alert" className="mg-notice">{error}</p>}
    <fieldset disabled={busy} className="season-form-section space-y-4">
      <legend className="season-form-legend">Season details</legend>
      <label className="block font-semibold">Season name<input className="input mt-1" required maxLength={200} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block font-semibold">Year<input className="input mt-1" type="number" required min={2000} max={2200} value={draft.year} onChange={(e) => setDraft({ ...draft, year: Number(e.target.value) })} /></label>
        <label className="block font-semibold">Format<select className="input mt-1" value={draft.format} onChange={(e) => setDraft({ ...draft, format: Number(e.target.value) as SectionFormat })}>{([2, 1, 3] as SectionFormat[]).map((format) => <option key={format} value={format}>{SectionFormatLabel[format]}</option>)}</select></label>
      </div>
      <label className="block font-semibold">Age group<input className="input mt-1" required maxLength={50} value={draft.ageGroup} onChange={(e) => setDraft({ ...draft, ageGroup: e.target.value })} placeholder="For example, Seniors" /></label>
      <p className="mg-meta">Use the same age group and format as the competition sections you want to include.</p>
    </fieldset>
    <fieldset disabled={busy} className="season-form-section space-y-4">
      <legend className="season-form-legend">Scoring</legend>
      <label className="block font-semibold">Points by place<textarea className="input mt-1" rows={3} required value={points} onChange={(e) => setPoints(e.target.value)} aria-describedby="season-points-help" /></label>
      <p id="season-points-help" className="mg-meta">First place first, separated by commas. Places beyond this list receive zero. Tied teams share a place and its points; the next place is skipped.</p>
      <label className="block font-semibold">Best results to count<input className="input mt-1" type="number" min={1} max={1000} value={draft.bestResultsToCount ?? ''} onChange={(e) => setDraft({ ...draft, bestResultsToCount: e.target.value === '' ? null : Number(e.target.value) })} placeholder="Leave blank to count every round" /></label>
      <p className="mg-meta">Changing points does not rewrite published rounds. Preview and publish a new version of each affected round.</p>
    </fieldset>
    <div className="flex flex-wrap gap-2"><button className="mg-btn mg-btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : label}</button><button className="mg-btn mg-btn-secondary" type="button" onClick={onCancel} disabled={busy}>Cancel</button></div>
  </form>;
}
