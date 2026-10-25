import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Plus, Search } from 'lucide-react';
import { api } from '../../api';
import { confirmDialog } from '../../components/ConfirmDialog';
import { DiagramEditor } from '../../components/DiagramEditor';
import { RaceDiagram } from '../../components/RaceDiagram';
import { useAuth } from '../../auth/AuthContext';
import { apiErrorMessage } from '../../lib/apiError';
import type { RaceTemplate } from '../../types';
import { RulebooksPanel } from '../operations/RulebooksPage';
import { Chevron, RefineHeader, RefineList, RefinePage } from '../refine/Refine';
import '../operations/operations.css';

type View = { kind: 'list' } | { kind: 'new' } | { kind: 'edit'; id: number } | { kind: 'rulebooks' };

const bodyOf = (race: RaceTemplate, patch: Partial<RaceTemplate> = {}) => {
  const next = { ...race, ...patch };
  return { name: next.name.trim(), category: next.category?.trim() || null, summary: next.summary?.trim() || null, rules: next.rules?.trim() || null, diagramJson: next.diagramJson?.trim() || null };
};

/** The race library with search, then the rulebooks. Opening a race shows its fields, and every change saves as it is made. */
export function RulesLibraryPage() {
  const { canEdit } = useAuth();
  const mayEdit = canEdit();
  const [races, setRaces] = useState<RaceTemplate[] | null>(null);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<View>({ kind: 'list' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get<RaceTemplate[]>('/race-templates')
      .then(({ data }) => { if (!cancelled) setRaces(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) { setRaces([]); setError('Couldn’t load the races. Try again.'); } });
    return () => { cancelled = true; };
  }, []);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (races ?? [])
      .filter((r) => !q || r.name.toLowerCase().includes(q) || (r.category ?? '').toLowerCase().includes(q) || (r.summary ?? '').toLowerCase().includes(q) || (r.rules ?? '').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [races, search]);

  const replace = (race: RaceTemplate) => setRaces((current) => (current ?? []).map((r) => (r.id === race.id ? { ...r, ...race } : r)));

  async function run(work: () => Promise<void>, failure: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    try { await work(); return true; }
    catch (caught) { setError(apiErrorMessage(caught, failure)); return false; }
    finally { setBusy(false); }
  }

  const save = (race: RaceTemplate, patch: Partial<RaceTemplate>) => run(async () => {
    const { data } = await api.put<RaceTemplate>(`/race-templates/${race.id}`, bodyOf(race, patch));
    replace({ ...race, ...patch, ...data });
  }, 'Couldn’t save that. Try again.');

  const create = (name: string) => run(async () => {
    const { data } = await api.post<RaceTemplate>('/race-templates', { name, category: null, summary: null, rules: null, diagramJson: '[]' });
    setRaces((current) => [...(current ?? []), data]);
    setView({ kind: 'edit', id: data.id });
  }, 'Couldn’t add that race. Try again.');

  async function remove(race: RaceTemplate) {
    if (!(await confirmDialog({ title: 'Delete this race?', message: `Delete “${race.name}” from the library? This can’t be undone.`, confirmLabel: 'Delete race', destructive: true }))) return;
    const ok = await run(async () => {
      await api.delete(`/race-templates/${race.id}`);
      setRaces((current) => (current ?? []).filter((r) => r.id !== race.id));
    }, 'Couldn’t delete that race. Try again.');
    if (ok) setView({ kind: 'list' });
  }

  const race = view.kind === 'edit' ? races?.find((r) => r.id === view.id) ?? null : null;
  const toList = () => { setError(null); setView({ kind: 'list' }); };
  const title = view.kind === 'new' ? 'New race' : view.kind === 'edit' ? 'Edit race' : view.kind === 'rulebooks' ? 'Rulebook files' : 'Rules library';

  return (
    <RefinePage>
      {view.kind === 'list'
        ? <RefineHeader back="/admin" backLabel="Back to site admin" context="Site admin" title={title} />
        : <RefineHeader onBack={toList} backLabel="Back to the rules library" context="Rules library" title={title} />}
      <div className="ops-cards ops-tt ops-admin" aria-busy={busy}>
        {error && <p role="alert" className="mg-notice ops-alert">{error}</p>}
        {view.kind !== 'list' && <button type="button" className="ops-back" onClick={toList}><ChevronLeft className="h-4 w-4" aria-hidden="true" />Rules library</button>}

        {view.kind === 'list' && (
          <>
            <label className="ops-search">
              <Search className="h-[18px] w-[18px]" aria-hidden="true" />
              <input type="search" aria-label="Search races" placeholder={races ? `Search ${races.length} races` : 'Search races'} value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            <h2 className="rf-sec ops-tt-head"><span>Races</span></h2>
            {races === null && <p role="status" className="rf-note">Loading…</p>}
            {races !== null && (
              <RefineList as="div" label="Races">
                {shown.map((r) => (
                  <button key={r.id} type="button" className="rf-row" onClick={() => { setError(null); setView({ kind: 'edit', id: r.id }); }}>
                    <span className="rf-grow"><span className="rf-t1">{r.name}</span>{r.summary && <span className="rf-t2 ops-oneline">{r.summary}</span>}</span>
                    <Chevron />
                  </button>
                ))}
                {shown.length === 0 && <div className="rf-row"><span className="rf-t2">{races.length === 0 ? 'No races yet' : 'No race called that'}</span></div>}
              </RefineList>
            )}
            {mayEdit && <button type="button" className="ops-addbar ops-addbar-gap" onClick={() => { setError(null); setView({ kind: 'new' }); }}><Plus className="h-4 w-4" aria-hidden="true" />New race</button>}

            <h2 className="rf-sec ops-tt-head"><span>Rulebooks</span></h2>
            <RefineList as="div" label="Rulebooks">
              <div className="rf-row"><span className="rf-grow rf-t1">Rulebook files</span><button type="button" className="rf-btn" onClick={() => setView({ kind: 'rulebooks' })}>Manage</button></div>
            </RefineList>
          </>
        )}

        {view.kind === 'new' && <NewRace busy={busy} onCreate={create} />}
        {view.kind === 'edit' && !race && <p role="status" className="rf-note">Loading…</p>}
        {view.kind === 'edit' && race && <EditRace key={race.id} race={race} mayEdit={mayEdit} busy={busy} onSave={(patch) => void save(race, patch)} onRemove={() => void remove(race)} />}
        {view.kind === 'rulebooks' && <RulebooksPanel />}
      </div>
    </RefinePage>
  );
}

/** A new race starts with its name: it is added when focus leaves the box or on Enter, then opens for the rest. */
function NewRace({ busy, onCreate }: { busy: boolean; onCreate: (name: string) => Promise<boolean> }) {
  const [name, setName] = useState('');
  const sent = useRef(false);
  async function submit() {
    const text = name.trim();
    if (!text || busy || sent.current) return;
    sent.current = true;
    if (!(await onCreate(text))) sent.current = false;
  }
  return (
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <h2 className="rf-sec ops-tt-head"><span>About</span></h2>
      <label className="rf-fld">Name<input autoFocus value={name} maxLength={80} onChange={(event) => setName(event.target.value)} onBlur={() => void submit()} /></label>
    </form>
  );
}

function EditRace({ race, mayEdit, busy, onSave, onRemove }: { race: RaceTemplate; mayEdit: boolean; busy: boolean; onSave: (patch: Partial<RaceTemplate>) => void; onRemove: () => void }) {
  const [name, setName] = useState(race.name);
  const [category, setCategory] = useState(race.category ?? '');
  const [summary, setSummary] = useState(race.summary ?? '');
  const [rules, setRules] = useState(race.rules ?? '');
  const [editDiagram, setEditDiagram] = useState(false);
  const [diagram, setDiagram] = useState(race.diagramJson ?? '[]');
  const timer = useRef<number | null>(null);
  const latest = useRef({ diagram, onSave, race });
  useEffect(() => { latest.current = { diagram, onSave, race }; });
  // Diagram edits are sent shortly after the last change, and the last one is sent on leaving.
  useEffect(() => () => {
    if (timer.current !== null) { window.clearTimeout(timer.current); latest.current.onSave({ diagramJson: latest.current.diagram }); }
  }, []);

  const field = (key: 'category' | 'summary' | 'rules', value: string) => { if (value.trim() !== (race[key] ?? '').trim()) onSave({ [key]: value.trim() || null }); };
  function saveName() {
    const next = name.trim();
    if (!next) { setName(race.name); return; }
    if (next !== race.name) onSave({ name: next });
  }
  function changeDiagram(json: string) {
    setDiagram(json);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { timer.current = null; onSave({ diagramJson: json }); }, 700);
  }

  if (!mayEdit) {
    return (
      <>
        <RaceDiagram diagramJson={race.diagramJson} height={130} />
        <h2 className="rf-sec ops-tt-head"><span>Rules</span></h2>
        <p className="ops-lines">{race.rules || 'No rules written yet.'}</p>
      </>
    );
  }
  return (
    <>
      <h2 className="rf-sec ops-tt-head"><span>About</span></h2>
      <div className="ops-fields">
        <label className="rf-fld">Name<input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} onBlur={saveName} /></label>
        <label className="rf-fld">Category<input value={category} placeholder="e.g. Bending, Equipment" onChange={(event) => setCategory(event.target.value)} onBlur={() => field('category', category)} /></label>
        <label className="rf-fld">One-line summary<input value={summary} onChange={(event) => setSummary(event.target.value)} onBlur={() => field('summary', summary)} /></label>
        <label className="rf-fld">Rules<textarea rows={6} value={rules} className="ops-textarea" onChange={(event) => setRules(event.target.value)} onBlur={() => field('rules', rules)} /></label>
      </div>

      <h2 className="rf-sec ops-tt-head"><span>Diagram</span></h2>
      <RefineList as="div" label="Diagram">
        <div className="ops-diagram"><RaceDiagram diagramJson={diagram} height={110} /></div>
        <div className="rf-row">
          <span className="rf-grow rf-t1">{editDiagram ? 'Editing the diagram' : 'Diagram'}</span>
          <button type="button" className="rf-btn" aria-expanded={editDiagram} onClick={() => setEditDiagram(!editDiagram)}>{editDiagram ? 'Done' : 'Edit diagram'}</button>
        </div>
      </RefineList>
      {editDiagram && <div className="ops-diagram-edit"><DiagramEditor value={diagram} onChange={changeDiagram} /></div>}

      {!race.isBuiltIn && <div className="ops-end-left ops-remove"><button type="button" className="ops-danger-link" disabled={busy} onClick={onRemove}>Delete this race</button></div>}
    </>
  );
}
