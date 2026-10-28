import { useT } from '../../i18n/LanguageContext';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../api';
import { Notice } from '../../components/Notice';
import { useToast } from '../../components/Toast';
import { Chevron, RefineList, RefineNote, RefineSection } from '../refine/Refine';
import type { SpecialAward } from './resultsBookTypes';
import { SelectField } from '../../components/SelectField';

interface SectionOption { id: number; displayName: string }
interface AwardDraft { key: number; competitionSectionId: number | null; title: string; recipient: string; note: string }

let nextKey = 1;
const blank = (): AwardDraft => ({ key: nextKey++, competitionSectionId: null, title: '', recipient: '', note: '' });

function message(error: unknown, fallback: string) {
  const candidate = error as { response?: { data?: { message?: string; detail?: string; title?: string } } };
  return candidate.response?.data?.message ?? candidate.response?.data?.detail ?? candidate.response?.data?.title ?? fallback;
}

/** The results book links, and the special awards that go in it. */
export function ResultsBookTab({ competitionId }: { competitionId: string }) {
  const t = useT();
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [awards, setAwards] = useState<AwardDraft[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<{ sections?: SectionOption[] }>(`/competitions/${competitionId}`),
      api.get<SpecialAward[]>(`/event-tools/competitions/${competitionId}/awards`),
    ]).then(([competition, list]) => {
      if (cancelled) return;
      setSections(competition.data.sections ?? []);
      setAwards(list.data.map((a) => ({ key: nextKey++, competitionSectionId: a.competitionSectionId, title: a.title, recipient: a.recipient, note: a.note ?? '' })));
      setLoaded(true);
    }).catch((caught) => { if (!cancelled) { setError(message(caught, t('ops3.rb.loadError'))); setLoadFailed(true); setLoaded(true); } });
    return () => { cancelled = true; };
  }, [competitionId, t]);

  function change(key: number, patch: Partial<AwardDraft>) {
    setAwards((current) => current.map((a) => (a.key === key ? { ...a, ...patch } : a)));
  }

  async function save() {
    setBusy(true); setError(null);
    try {
      await api.put(`/event-tools/competitions/${competitionId}/awards`, {
        awards: awards.filter((a) => a.title.trim() || a.recipient.trim()).map((a) => ({
          competitionSectionId: a.competitionSectionId, title: a.title, recipient: a.recipient, note: a.note.trim() || null,
        })),
      });
      toast.show(t('ops3.rb.saved'));
    } catch (caught) { setError(message(caught, t('ops3.rb.saveError'))); }
    finally { setBusy(false); }
  }

  const base = `/event-tools/${competitionId}/print`;
  return <section aria-labelledby="book-title">
    <RefineSection title={t('ops3.rb.title')} />
    <h2 id="book-title" className="sr-only">{t('ops3.rb.title')}</h2>
    <RefineNote>{t('ops3.rb.intro')}</RefineNote>
    <nav aria-label={t('ops3.rb.title')}><RefineList as="div">
      <Link className="rf-row" to={`${base}/results-book`}>
        <span className="rf-grow"><span className="rf-t1">{t('ops3.rb.title')}</span><span className="rf-t2">{t('ops3.rb.public')}</span></span><Chevron />
      </Link>
      <Link className="rf-row" to={`${base}/results-book-organiser`}>
        <span className="rf-grow"><span className="rf-t1">{t('ops3.rb.organiser')}</span><span className="rf-t2">{t('ops3.rb.organiserSub')}</span></span><Chevron />
      </Link>
    </RefineList></nav>

    <RefineSection title={t('ops3.book.awards')} />
    {error && <Notice className="tools-msg">{error}</Notice>}
    {/* Without the saved list, saving would replace the real awards with an empty one, so the editor stays hidden. */}
    {loaded && !loadFailed && <div className="tools-form">
      {awards.length === 0 && <RefineNote>{t('ops3.rb.noAwards')}</RefineNote>}
      {awards.map((award, index) => <fieldset key={award.key} className="tools-fields"><legend className="sr-only">{t('ops3.rb.award', { n: index + 1 })}</legend>
        <label className="rf-fld">{t('ops3.rb.awardName')}<input value={award.title} maxLength={100} onChange={(event) => change(award.key, { title: event.target.value })} /></label>
        <label className="rf-fld">{t('ops3.rb.winner')}<input value={award.recipient} maxLength={200} onChange={(event) => change(award.key, { recipient: event.target.value })} /></label>
        <label className="rf-fld">{t('ops3.book.ageGroup')}
          <SelectField value={award.competitionSectionId ?? ''} onChange={(event) => change(award.key, { competitionSectionId: event.target.value ? Number(event.target.value) : null })}>
            <option value="">{t('ops3.rb.whole')}</option>
            {sections.map((section) => <option key={section.id} value={section.id}>{section.displayName}</option>)}
          </SelectField>
        </label>
        <label className="rf-fld">{t('ops2.pd.noteOptional')}<input value={award.note} maxLength={300} onChange={(event) => change(award.key, { note: event.target.value })} /></label>
        <button type="button" className="rf-btn rf-btn-text" onClick={() => { setAwards((current) => current.filter((a) => a.key !== award.key)); }}>
          <Trash2 className="h-4 w-4" aria-hidden="true" />{t('ops3.rb.remove', { n: index + 1 })}
        </button>
      </fieldset>)}
      <button type="button" className="rf-btn rf-btn-text" onClick={() => { setAwards((current) => [...current, blank()]); }}><Plus className="h-4 w-4" aria-hidden="true" />{t('ops3.rb.add')}</button>
      <button type="button" className="rf-btn rf-btn-primary rf-wide" disabled={busy} onClick={save}>{busy ? t('common.saving') : t('ops3.rb.save')}</button>
      {toast.node}
    </div>}
  </section>;
}
