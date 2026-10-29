import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { type CompetitionSummary, type SectionFormat } from '../../types';
import { RefineDisclosure, RefineFoot, RefineList, RefineNote, RefineSection, RefineSwitchRow } from '../refine/Refine';
import { ordinal } from './seasonModel';
import { seasonError, type SeasonSettings } from './seasonViewTypes';
import './seasonViews.css';
import { SelectField } from '../../components/SelectField';
import { NumberField } from '../../components/NumberField';
import { Notice } from '../../components/Notice';
import { useT } from '../../i18n/LanguageContext';
import type { Translate } from '../../i18n/translate';
import { sectionFormatText } from '../../lib/sectionFormatText';

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

type Checked = { payload: SeasonSettings; error?: undefined } | { payload?: undefined; error: string };

/** Turns the draft into the settings to send, or says what's wrong with it. */
function check(draft: Draft, t: Translate): Checked {
  const title = draft.title.trim();
  const ageGroup = draft.ageGroup.trim() || 'All age groups';
  const year = Number(draft.year);
  const best = draft.best.trim() === '' ? null : Number(draft.best);
  const values = draft.points.map((text) => (text.trim() === '' ? Number.NaN : Number(text)));
  if (!title) return { error: t('site.seasons.form.nameRequired') };
  if (!Number.isInteger(year) || year < 2000 || year > 2200) return { error: t('site.seasons.form.yearRange') };
  if (best !== null && (!Number.isInteger(best) || best < 1 || best > 1000)) return { error: t('site.seasons.form.bestRange') };
  if (!values.length || values.length > 100 || values.some((n, i) => !Number.isSafeInteger(n) || n < 0 || n > 1000000 || (i > 0 && n > values[i - 1]))) return { error: t('site.seasons.form.pointsError') };
  return { payload: { title, year, format: draft.format, ageGroup, bestResultsToCount: best, placePoints: values.map((n, i) => ({ place: i + 1, points: n })) } };
}

/** How long after the last edit a change is saved on its own (leaving a field saves it at once). */
const AUTOSAVE_MS = 700;

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

/**
 * The season's settings. Creating one shows a Create and Cancel footer. Editing one has no Save button: each change is
 * saved as it's made, with a quiet "Saving…" / "Saved" line, and a change that isn't valid yet waits until it is.
 */
export function SeasonSettingsForm({ value = initial, onSave, onCancel, label = 'Save', create = false }: {
  value?: SeasonSettings;
  /** Called with the checked settings: once on Create, or after each change when editing. */
  onSave: (settings: SeasonSettings) => Promise<void>;
  /** Used by the create form's Cancel button. */
  onCancel?: () => void;
  label?: string;
  /** The create form always shows its actions; the edit form saves as you go. */
  create?: boolean;
}) {
  const t = useT();
  const [competitionError, setCompetitionError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saved] = useState(() => toDraft(value));
  const [draft, setDraft] = useState<Draft>(saved);
  const [competitions, setCompetitions] = useState<Pick<CompetitionSummary, 'id' | 'name' | 'startDate'>[]>([]);
  const [selectedCompetitionIds, setSelectedCompetitionIds] = useState<number[]>(value.competitionIds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [state, setState] = useState<SaveState>('idle');
  const patch = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }));
  const setPoint = (index: number, text: string) => setDraft((current) => ({ ...current, points: current.points.map((item, i) => (i === index ? text : item)) }));

  const checked = useMemo(() => check(draft, t), [draft, t]);
  const draftKey = JSON.stringify(draft);
  const [savedKey, setSavedKey] = useState(() => JSON.stringify(saved));
  const pending = useRef<{ payload: SeasonSettings; key: string } | null>(null);
  const failed = useRef<{ payload: SeasonSettings; key: string } | null>(null);
  const inFlight = useRef(false);
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const failureText = t('site.seasons.form.saveFailed');

  async function flush() {
    const job = pending.current;
    if (!job || inFlight.current) return;
    pending.current = null;
    inFlight.current = true;
    setState('saving');
    try {
      await onSave(job.payload);
      failed.current = null;
      setError('');
      setSavedKey(job.key);
      setState(pending.current ? 'saving' : 'saved');
    } catch (reason) {
      failed.current = job;
      setError(seasonError(reason, failureText));
      setState('failed');
    } finally {
      inFlight.current = false;
      if (pending.current) void flushRef.current();
    }
  }
  useEffect(() => { flushRef.current = flush; });

  // Editing saves as you go: a valid change waits a moment for more typing, then goes.
  useEffect(() => {
    if (create) return;
    if (draftKey === savedKey || !checked.payload) { pending.current = null; return; }
    pending.current = { payload: checked.payload, key: draftKey };
    const timer = setTimeout(() => void flushRef.current(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [create, draftKey, savedKey, checked]);
  // Leaving the page shouldn't lose a change that is still waiting.
  useEffect(() => () => { void flushRef.current(); }, []);

  useEffect(() => {
    if (!create) return;
    const controller = new AbortController();
    api.get<Pick<CompetitionSummary, 'id' | 'name' | 'startDate'>[]>('/seasons/available-competitions', { signal: controller.signal })
      .then(({ data }) => {
        if (!controller.signal.aborted) {
          setCompetitions(data);
          setCompetitionError(false);
        }
      }).catch(() => { if (!controller.signal.aborted) setCompetitionError(true); });
    return () => controller.abort();
  }, [create, loadAttempt]);

  function toggleCompetition(compId: number) {
    setSelectedCompetitionIds((current) =>
      current.includes(compId) ? current.filter((id) => id !== compId) : [...current, compId],
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!create) { void flush(); return; }
    const { payload } = checked;
    if (!payload) { setError(checked.error ?? ''); return; }
    setBusy(true); setError('');
    try {
      await onSave({ ...payload, ...(selectedCompetitionIds.length > 0 ? { competitionIds: selectedCompetitionIds } : {}) });
    } catch (reason) { setError(seasonError(reason, failureText)); }
    finally { setBusy(false); }
  }

  const pointsSummary = draft.points.slice(0, 10).map((text) => text.trim() || '–').join(' · ') + (draft.points.length > 10 ? ' …' : '');
  const bestNumber = Number(draft.best);
  const bestSummary = draft.best.trim() && Number.isInteger(bestNumber) && bestNumber > 0 ? t('site.seasons.form.bestSummary', { count: bestNumber }) : t('site.seasons.form.everyRound');
  const dirty = !create && draftKey !== savedKey;
  const shownError = error || (dirty && checked.error) || '';

  return <form onSubmit={submit} onBlur={() => { if (!create) void flush(); }} noValidate className="sv-form">
    {shownError && <Notice className="mt-3" actionLabel={state === 'failed' && !create ? t('common.tryAgain') : undefined} onAction={state === 'failed' && !create ? () => { pending.current = failed.current; void flush(); } : undefined}>{shownError}</Notice>}
    <RefineSection title={t('site.seasons.form.howWorked')} meta={create ? undefined : t('site.seasons.form.organisersOnly')} />
    <RefineList as="div">
      <RefineDisclosure title={t('site.seasons.form.sections')} sub={`${draft.ageGroup.trim() || 'All age groups'} · ${sectionFormatText(draft.format, t)}`} defaultOpen={create}>
        <fieldset disabled={busy} className="sv-fieldset sv-body">
          <legend className="sr-only">{t('site.seasons.form.details')}</legend>
          <label className="rf-fld">{t('site.seasons.form.name')}<input required maxLength={200} value={draft.title} onChange={(e) => patch({ title: e.target.value })} /></label>
          <div className="sv-two">
            <label className="rf-fld">{t('site.seasons.form.year')}<NumberField required min={2000} max={2200} value={draft.year} onChange={(e) => patch({ year: e.target.value })} /></label>
            <label className="rf-fld">{t('site.seasons.form.format')}<SelectField value={draft.format} onChange={(e) => patch({ format: Number(e.target.value) as SectionFormat })}>{([2, 1, 3] as SectionFormat[]).map((format) => <option key={format} value={format}>{sectionFormatText(format, t)}</option>)}</SelectField></label>
          </div>
          <label className="rf-fld">{t('site.seasons.ageGroup')}<input maxLength={50} value={draft.ageGroup} onChange={(e) => patch({ ageGroup: e.target.value })} placeholder={t('site.seasons.form.ageGroupPlaceholder')} /></label>
          <p className="rf-note sv-flush">{t('site.seasons.form.coversAll')}</p>
        </fieldset>
      </RefineDisclosure>
      {create && <RefineDisclosure title={t('site.seasons.form.competitions')} sub={selectedCompetitionIds.length ? t('site.seasons.form.selected', { count: selectedCompetitionIds.length }) : t('site.seasons.form.competitionsOptional')} defaultOpen>
        <fieldset disabled={busy} className="sv-fieldset sv-body">
          <legend className="sr-only">{t('site.seasons.form.includeCompetitions')}</legend>
          {competitionError && <Notice actionLabel={t('common.tryAgain')} onAction={() => setLoadAttempt((attempt) => attempt + 1)}>{t('site.seasons.competitionsFailed')}</Notice>}
          {competitions.length === 0 ? (
            <p className="rf-note sv-flush">{t('site.seasons.form.addLater')}</p>
          ) : (
            <div className="sv-picks">
              {competitions.map((comp) => (
                <RefineSwitchRow key={comp.id} label={`${comp.name} · ${new Date(comp.startDate).getFullYear()}`} on={selectedCompetitionIds.includes(comp.id)} onChange={() => toggleCompetition(comp.id)} />
              ))}
            </div>
          )}
        </fieldset>
      </RefineDisclosure>}
      <RefineDisclosure title={t('site.seasons.form.placePoints')} sub={pointsSummary} defaultOpen>
        <fieldset disabled={busy} className="sv-fieldset sv-body">
          <legend className="sr-only">{t('site.seasons.form.pointsByPlace')}</legend>
          <div className="sv-points">
            {draft.points.map((text, index) => <label key={index} className="rf-fld sv-pt">{ordinal(index + 1)}<input type="text" inputMode="numeric" value={text} onChange={(e) => setPoint(index, e.target.value)} /></label>)}
            <label className="rf-fld sv-pt-wide">{t('site.seasons.form.dnf')}<input type="text" inputMode="numeric" value="0" readOnly aria-readonly="true" /></label>
          </div>
          <div className="sv-places">
            <button type="button" className="rf-btn rf-btn-text" disabled={draft.points.length >= 100} onClick={() => patch({ points: [...draft.points, draft.points[draft.points.length - 1] ?? '0'] })}>{t('site.seasons.form.addPlace')}</button>
            <button type="button" className="rf-btn rf-btn-text" disabled={draft.points.length <= 1} onClick={() => patch({ points: draft.points.slice(0, -1) })}>{t('site.seasons.form.removePlace')}</button>
          </div>
          <p className="rf-note sv-flush">{t('site.seasons.form.unlisted')}</p>
        </fieldset>
      </RefineDisclosure>
      <RefineDisclosure title={t('site.seasons.form.resultsCount')} sub={bestSummary}>
        <fieldset disabled={busy} className="sv-fieldset sv-body">
          <legend className="sr-only">{t('site.seasons.form.resultsCount')}</legend>
          <label className="rf-fld">{t('site.seasons.form.bestLabel')}<NumberField min={1} max={1000} value={draft.best} onChange={(e) => patch({ best: e.target.value })} placeholder={t('site.seasons.form.bestPlaceholder')} /></label>
        </fieldset>
      </RefineDisclosure>
      <RefineDisclosure title={t('site.seasons.form.ties')} sub={t('site.seasons.form.tiesSub')}>
        <p className="rf-note sv-body">{t('site.seasons.form.tiesBody')}</p>
      </RefineDisclosure>
    </RefineList>
    <RefineNote>{t('site.seasons.form.pairsNote')}</RefineNote>
    <RefineNote>{t('site.seasons.form.republishNote')}</RefineNote>
    {create
      ? <RefineFoot>
        <span className="rf-grow" />
        <button type="button" className="rf-btn rf-btn-text" disabled={busy} onClick={() => onCancel?.()}>{t('common.cancel')}</button>
        <button type="submit" className="rf-btn rf-btn-primary" disabled={busy}>{busy ? t('common.saving') : label}</button>
      </RefineFoot>
      : <p className="rf-note sv-save" role="status" aria-live="polite">{state === 'saving' ? t('common.saving') : state === 'saved' && !dirty ? t('site.seasons.form.saved') : ''}</p>}
  </form>;
}
