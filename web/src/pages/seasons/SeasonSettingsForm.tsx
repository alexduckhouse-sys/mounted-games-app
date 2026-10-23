import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { SectionFormatLabel, type CompetitionSummary, type SectionFormat } from '../../types';
import { RefineDisclosure, RefineFoot, RefineList, RefineNote, RefineSection } from '../refine/Refine';
import { ordinal } from './seasonModel';
import { seasonError, type SeasonSettings } from './seasonViewTypes';
import './seasonViews.css';
import { SelectField } from '../../components/SelectField';
import { NumberField } from '../../components/NumberField';

const initial: SeasonSettings = {
  title: '', year: new Date().getFullYear(), format: 2, ageGroup: 'All age groups',
  bestResultsToCount: null, placePoints: [10, 8, 6, 4, 2, 1].map((points, i) => ({ place: i + 1, points })),
};

interface Draft { title: string; year: string; format: SectionFormat; ageGroup: string; best: string; points: string[] }

function toDraft(value: SeasonSettings): Draft {
  return {
    title: value.title, year: String(value.year), format: value.format, ageGroup: value.ageGroup,
    best: value.bestResultsToCount == null ? '' : String(value.bestResultsToCount),
    points: value.placePoints.map((rule) => String(rule.points)),
  };
}

/** How many separate edits differ from the saved settings. */
function changeCount(draft: Draft, saved: Draft): number {
  let count = 0;
  if (draft.title !== saved.title) count += 1;
  if (draft.year !== saved.year) count += 1;
  if (draft.format !== saved.format) count += 1;
  if (draft.ageGroup !== saved.ageGroup) count += 1;
  if (draft.best.trim() !== saved.best) count += 1;
  const places = Math.max(draft.points.length, saved.points.length);
  for (let i = 0; i < places; i += 1) if (draft.points[i]?.trim() !== saved.points[i]) count += 1;
  return count;
}

const POINTS_ERROR = 'Enter points from first place downwards. Use whole numbers from 0 to 1,000,000, with no increase for a lower place.';

export function SeasonSettingsForm({ value = initial, onSave, onCancel, label = 'Save', create = false }: {
  value?: SeasonSettings;
  onSave: (settings: SeasonSettings) => Promise<void>;
  /** Used by the create form's Cancel button. Editing uses Discard, which restores the saved settings. */
  onCancel?: () => void;
  label?: string;
  /** The create form always shows its actions; the edit form shows them only once something has changed. */
  create?: boolean;
}) {
  const [saved] = useState(() => toDraft(value));
  const [draft, setDraft] = useState<Draft>(saved);
  const [competitions, setCompetitions] = useState<CompetitionSummary[]>([]);
  const [selectedCompetitionIds, setSelectedCompetitionIds] = useState<number[]>(value.competitionIds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changes = changeCount(draft, saved);
  const dirty = changes > 0;
  const patch = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }));
  const setPoint = (index: number, text: string) => setDraft((current) => ({ ...current, points: current.points.map((item, i) => (i === index ? text : item)) }));

  useEffect(() => {
    if (!create) return;
    const controller = new AbortController();
    const req = api.get<CompetitionSummary[]>('/competitions', { params: { includeArchived: true }, signal: controller.signal });
    if (req && typeof req.then === 'function') {
      req.then((res) => {
        if (!controller.signal.aborted && Array.isArray(res?.data)) setCompetitions(res.data);
      }).catch(() => {});
    }
    return () => controller.abort();
  }, [create]);

  function toggleCompetition(compId: number) {
    setSelectedCompetitionIds((current) =>
      current.includes(compId) ? current.filter((id) => id !== compId) : [...current, compId],
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const title = draft.title.trim();
    const ageGroup = draft.ageGroup.trim() || 'All age groups';
    const year = Number(draft.year);
    const best = draft.best.trim() === '' ? null : Number(draft.best);
    const values = draft.points.map((text) => (text.trim() === '' ? Number.NaN : Number(text)));
    if (!title) { setError('Give the season a name.'); return; }
    if (!Number.isInteger(year) || year < 2000 || year > 2200) { setError('Enter a year between 2000 and 2200.'); return; }
    if (best !== null && (!Number.isInteger(best) || best < 1 || best > 1000)) { setError('Results that count must be a whole number from 1 to 1,000, or blank to count every round.'); return; }
    if (!values.length || values.length > 100 || values.some((n, i) => !Number.isSafeInteger(n) || n < 0 || n > 1000000 || (i > 0 && n > values[i - 1]))) { setError(POINTS_ERROR); return; }
    setBusy(true); setError('');
    try {
      const payload: SeasonSettings = {
        title, year, format: draft.format, ageGroup, bestResultsToCount: best,
        placePoints: values.map((n, i) => ({ place: i + 1, points: n })),
        ...(create && selectedCompetitionIds.length > 0 ? { competitionIds: selectedCompetitionIds } : {}),
      };
      await onSave(payload);
    } catch (reason) { setError(seasonError(reason, 'The season couldn’t be saved. Check your connection and try again.')); }
    finally { setBusy(false); }
  }

  const pointsSummary = draft.points.slice(0, 10).map((text) => text.trim() || '–').join(' · ') + (draft.points.length > 10 ? ' …' : '');
  const bestNumber = Number(draft.best);
  const bestSummary = draft.best.trim() && Number.isInteger(bestNumber) && bestNumber > 0 ? `Best ${bestNumber} ${bestNumber === 1 ? 'round' : 'rounds'} per team` : 'Every round counts';

  return <form onSubmit={submit} noValidate className="sv-form">
    {error && <p role="alert" className="mg-notice mt-3">{error}</p>}
    <RefineSection title="How standings are worked out" meta={create ? undefined : 'Organisers only'} />
    <RefineList as="div">
      <RefineDisclosure title="Sections" sub={`${draft.ageGroup.trim() || 'All age groups'} · ${SectionFormatLabel[draft.format]}`} defaultOpen={create}>
        <fieldset disabled={busy} className="sv-fieldset sv-body">
          <legend className="sr-only">Season details</legend>
          <label className="rf-fld">Season name<input required maxLength={200} value={draft.title} onChange={(e) => patch({ title: e.target.value })} /></label>
          <div className="sv-two">
            <label className="rf-fld">Year<NumberField required min={2000} max={2200} value={draft.year} onChange={(e) => patch({ year: e.target.value })} /></label>
            <label className="rf-fld">Format<SelectField value={draft.format} onChange={(e) => patch({ format: Number(e.target.value) as SectionFormat })}>{([2, 1, 3] as SectionFormat[]).map((format) => <option key={format} value={format}>{SectionFormatLabel[format]}</option>)}</SelectField></label>
          </div>
          <label className="rf-fld">Age group<input maxLength={50} value={draft.ageGroup} onChange={(e) => patch({ ageGroup: e.target.value })} placeholder="All age groups (or e.g. Seniors)" /></label>
          <p className="rf-note sv-flush">A season can include sections across all age groups and formats.</p>
        </fieldset>
      </RefineDisclosure>
      {create && <RefineDisclosure title="Competitions" sub={selectedCompetitionIds.length ? `${selectedCompetitionIds.length} selected` : 'Optional — or add rounds later'} defaultOpen>
        <fieldset disabled={busy} className="sv-fieldset sv-body">
          <legend className="sr-only">Include competitions</legend>
          {competitions.length === 0 ? (
            <p className="rf-note sv-flush">You can also add competition rounds after creating the season.</p>
          ) : (
            <div className="sv-stack">
              {competitions.map((comp) => (
                <label key={comp.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedCompetitionIds.includes(comp.id)}
                    onChange={() => toggleCompetition(comp.id)}
                  />
                  <span>{comp.name} · {new Date(comp.startDate).getFullYear()}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
      </RefineDisclosure>}
      <RefineDisclosure title="Place points" sub={pointsSummary} defaultOpen>
        <fieldset disabled={busy} className="sv-fieldset sv-body">
          <legend className="sr-only">Points by place</legend>
          <div className="sv-points">
            {draft.points.map((text, index) => <label key={index} className="rf-fld sv-pt">{ordinal(index + 1)}<input type="text" inputMode="numeric" value={text} onChange={(e) => setPoint(index, e.target.value)} /></label>)}
            <label className="rf-fld sv-pt-wide">Did not finish / eliminated<input type="text" inputMode="numeric" value="0" readOnly aria-readonly="true" /></label>
          </div>
          <div className="sv-places">
            <button type="button" className="rf-btn rf-btn-text" disabled={draft.points.length >= 100} onClick={() => patch({ points: [...draft.points, draft.points[draft.points.length - 1] ?? '0'] })}>Add place</button>
            <button type="button" className="rf-btn rf-btn-text" disabled={draft.points.length <= 1} onClick={() => patch({ points: draft.points.slice(0, -1) })}>Remove last place</button>
          </div>
          <p className="rf-note sv-flush">First place first. Places after the last one listed score 0, the same as did not finish or eliminated.</p>
        </fieldset>
      </RefineDisclosure>
      <RefineDisclosure title="Results that count" sub={bestSummary}>
        <fieldset disabled={busy} className="sv-fieldset sv-body">
          <legend className="sr-only">Results that count</legend>
          <label className="rf-fld">Best results to count<NumberField min={1} max={1000} value={draft.best} onChange={(e) => patch({ best: e.target.value })} placeholder="Leave blank to count every round" /></label>
        </fieldset>
      </RefineDisclosure>
      <RefineDisclosure title="Ties" sub="Most round wins (1st places), then share the place">
        <p className="rf-note sv-body">Season point ties break on most round wins (1st places) first; still-tied teams share a place and its points.</p>
      </RefineDisclosure>
    </RefineList>
    <RefineNote>Saving doesn’t change published rounds. Preview and publish a new version of each affected round to apply new points.</RefineNote>
    {(create || dirty) && <RefineFoot>
      <span className="rf-grow rf-t2" role="status">{create ? '' : `${changes} unsaved ${changes === 1 ? 'change' : 'changes'}`}</span>
      <button type="button" className="rf-btn rf-btn-text" disabled={busy} onClick={() => { if (create) onCancel?.(); else { setDraft(saved); setError(''); } }}>{create ? 'Cancel' : 'Discard'}</button>
      <button type="submit" className="rf-btn rf-btn-primary" disabled={busy}>{busy ? 'Saving…' : label}</button>
    </RefineFoot>}
  </form>;
}
