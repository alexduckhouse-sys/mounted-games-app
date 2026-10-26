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
    }).catch((caught) => { if (!cancelled) { setError(message(caught, 'Couldn’t load the awards. Check your signal and try again.')); setLoadFailed(true); setLoaded(true); } });
    return () => { cancelled = true; };
  }, [competitionId]);

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
      toast.show('Awards saved');
    } catch (caught) { setError(message(caught, 'Couldn’t save the awards. Check your signal and try again.')); }
    finally { setBusy(false); }
  }

  const base = `/event-tools/${competitionId}/print`;
  return <section aria-labelledby="book-title">
    <RefineSection title="Results book" />
    <h2 id="book-title" className="sr-only">Results book</h2>
    <RefineNote>The final standings for every age group, each final and any special awards. Print it, or download it as a CSV from the page.</RefineNote>
    <nav aria-label="Results book"><RefineList as="div">
      <Link className="rf-row" to={`${base}/results-book`}>
        <span className="rf-grow"><span className="rf-t1">Results book</span><span className="rf-t2">The public version, to hand out or publish</span></span><Chevron />
      </Link>
      <Link className="rf-row" to={`${base}/results-book-organiser`}>
        <span className="rf-grow"><span className="rf-t1">Organiser copy</span><span className="rf-t2">The same, plus the referee’s private notes</span></span><Chevron />
      </Link>
    </RefineList></nav>

    <RefineSection title="Special awards" />
    {error && <Notice className="tools-msg">{error}</Notice>}
    {/* Without the saved list, saving would replace the real awards with an empty one, so the editor stays hidden. */}
    {loaded && !loadFailed && <div className="tools-form">
      {awards.length === 0 && <RefineNote>No special awards yet. Add one for best turned out, spirit of the games and so on.</RefineNote>}
      {awards.map((award, index) => <fieldset key={award.key} className="tools-fields"><legend className="sr-only">Award {index + 1}</legend>
        <label className="rf-fld">Award<input value={award.title} maxLength={100} onChange={(event) => change(award.key, { title: event.target.value })} /></label>
        <label className="rf-fld">Winner<input value={award.recipient} maxLength={200} onChange={(event) => change(award.key, { recipient: event.target.value })} /></label>
        <label className="rf-fld">Age group
          <SelectField value={award.competitionSectionId ?? ''} onChange={(event) => change(award.key, { competitionSectionId: event.target.value ? Number(event.target.value) : null })}>
            <option value="">Whole event</option>
            {sections.map((section) => <option key={section.id} value={section.id}>{section.displayName}</option>)}
          </SelectField>
        </label>
        <label className="rf-fld">Note (optional)<input value={award.note} maxLength={300} onChange={(event) => change(award.key, { note: event.target.value })} /></label>
        <button type="button" className="rf-btn rf-btn-text" onClick={() => { setAwards((current) => current.filter((a) => a.key !== award.key)); }}>
          <Trash2 className="h-4 w-4" aria-hidden="true" />Remove award {index + 1}
        </button>
      </fieldset>)}
      <button type="button" className="rf-btn rf-btn-text" onClick={() => { setAwards((current) => [...current, blank()]); }}><Plus className="h-4 w-4" aria-hidden="true" />Add an award</button>
      <button type="button" className="rf-btn rf-btn-primary rf-wide" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save awards'}</button>
      {toast.node}
    </div>}
  </section>;
}
