import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Code, Lock, Plus, Search } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import type { RaceTemplate } from '../../types';
import { RaceDiagram } from '../../components/RaceDiagram';
import { DiagramEditor } from '../../components/DiagramEditor';
import { FieldDrop, PartHead } from './LaptopParts';
import { confirmDialog } from '../../components/ConfirmDialog';
import { usePageWidth } from '../../components/pageWidthState';
import { RulebooksPanel } from '../operations/RulebooksPage';

type DraftForm = {
  id: number | null;
  name: string;
  category: string;
  summary: string;
  rules: string;
  diagramJson: string;
};

const EMPTY: DraftForm = { id: null, name: '', category: '', summary: '', rules: '', diagramJson: '[]' };
const ALL = '';

/** A text field in the Create competition style: label above, 48px box. */
function Labelled({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return <label className={`flex flex-col gap-2 text-base font-medium ${className}`}>{label}{children}</label>;
}

/**
 * The race library and rulebooks editor. Each race is a row; opening one shows its rules and diagram,
 * and for an admin turns the row into the editor. The Rulebooks tab opens the global rulebooks.
 */
export function RulesPage() {
  usePageWidth('wide');
  const [tab, setTab] = useState<'races' | 'rulebooks'>('races');

  return (
    <div className="skin mx-auto flex w-full max-w-5xl flex-col gap-7 pb-16 pt-6 sm:pt-10">
      <div className="flex flex-wrap items-end gap-4">
        <h1 className="mg-display flex-1 text-[44px] font-bold leading-none text-[rgb(var(--mg-heading))]">
          {tab === 'races' ? 'Race rules' : 'Rulebooks'}
        </h1>
        <Link to="/admin" className="mg-btn mg-btn-secondary !min-h-[50px] !rounded-[10px] !px-4 !text-base">Admin</Link>
      </div>

      <div role="tablist" aria-label="Rules and rulebooks" className="flex gap-2 border-b border-[rgb(var(--mg-rule-soft))] pb-2">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'races'}
          onClick={() => setTab('races')}
          className={`mg-btn !min-h-11 !rounded-[10px] !px-4 !text-[15px] ${tab === 'races' ? 'mg-btn-primary' : 'mg-btn-secondary'}`}
        >
          Game rules
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'rulebooks'}
          onClick={() => setTab('rulebooks')}
          className={`mg-btn !min-h-11 !rounded-[10px] !px-4 !text-[15px] ${tab === 'rulebooks' ? 'mg-btn-primary' : 'mg-btn-secondary'}`}
        >
          Rulebooks
        </button>
      </div>

      {tab === 'races' ? <RaceRulesLibrary /> : <RulebooksPanel />}
    </div>
  );
}

export function RaceRulesLibrary() {
  const { canEdit } = useAuth();
  const [list, setList] = useState<RaceTemplate[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState(ALL);
  const [draft, setDraft] = useState<DraftForm | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDiagram, setShowDiagram] = useState(false);
  const [showJson, setShowJson] = useState(false);

  function load() {
    api.get<RaceTemplate[]>('/race-templates').then((r) => setList(r.data)).catch(() => {});
  }
  useEffect(load, []);

  const categories = useMemo(() => [...new Set(list.map((r) => r.category?.trim() || 'Other'))].sort((a, b) => a.localeCompare(b)), [list]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list
      .filter((r) => category === ALL || (r.category?.trim() || 'Other') === category)
      .filter((r) => !q || r.name.toLowerCase().includes(q) || (r.category ?? '').toLowerCase().includes(q) || (r.summary ?? '').toLowerCase().includes(q) || (r.rules ?? '').toLowerCase().includes(q))
      .sort((a, b) => (a.category?.trim() || 'Other').localeCompare(b.category?.trim() || 'Other') || a.name.localeCompare(b.name));
  }, [list, search, category]);

  function startNew() {
    setDraft({ ...EMPTY });
    setOpenId(null);
    setShowDiagram(false);
    setError(null);
  }
  function open(r: RaceTemplate) {
    setError(null);
    setShowDiagram(false);
    if (openId === r.id) { setOpenId(null); setDraft(null); return; }
    setOpenId(r.id);
    setDraft(canEdit() ? { id: r.id, name: r.name, category: r.category ?? '', summary: r.summary ?? '', rules: r.rules ?? '', diagramJson: r.diagramJson ?? '[]' } : null);
  }
  function close() {
    setDraft(null);
    setOpenId(null);
    setError(null);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: draft.name.trim(),
        category: draft.category.trim() || null,
        summary: draft.summary.trim() || null,
        rules: draft.rules.trim() || null,
        diagramJson: draft.diagramJson.trim() || null,
      };
      if (draft.id == null) {
        await api.post('/race-templates', payload);
      } else {
        await api.put(`/race-templates/${draft.id}`, payload);
      }
      close();
      load();
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } | string } }).response?.data;
      setError(typeof msg === 'string' ? msg : msg?.message ?? 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: RaceTemplate) {
    if (!(await confirmDialog({ title: 'Delete this race?', message: `Delete "${r.name}" from the library? This can’t be undone.`, confirmLabel: 'Delete race', destructive: true }))) return;
    try {
      await api.delete(`/race-templates/${r.id}`);
      close();
      load();
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } | string } }).response?.data;
      setError(typeof msg === 'string' ? msg : msg?.message ?? 'Could not delete.');
    }
  }

  const editor = (r: RaceTemplate | null) => draft && (
    <form onSubmit={save} className="flex flex-col gap-[18px] bg-[rgb(var(--mg-subtle))] px-4 pb-5 pt-4 shadow-[inset_3px_0_0_rgb(var(--mg-heading))]">
      <PartHead id={`rules-edit-${draft.id ?? 'new'}`} title={draft.id == null ? 'New race' : 'Edit race'} meta={r && !r.isBuiltIn
        ? <button type="button" onClick={() => void remove(r)} className="-my-3 min-h-11 px-2.5 text-sm font-semibold text-[rgb(var(--mg-elim))]">Delete</button> : undefined} />
      <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Labelled label="Name"><span className="mg-field !min-h-12"><input value={draft.name} required onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></span></Labelled>
        <Labelled label="Category"><span className="mg-field !min-h-12"><input value={draft.category} placeholder="e.g. Bending, Equipment" onChange={(e) => setDraft({ ...draft, category: e.target.value })} /></span></Labelled>
      </div>
      <Labelled label="One-line summary"><span className="mg-field !min-h-12"><input value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} /></span></Labelled>
      <Labelled label="Rules"><span className="mg-field !items-start !py-2.5"><textarea rows={4} className="min-w-0 flex-1 resize-y border-0 bg-transparent outline-none" value={draft.rules} onChange={(e) => setDraft({ ...draft, rules: e.target.value })} /></span></Labelled>
      <div className="flex flex-col gap-2">
        <span className="text-base font-medium">Diagram</span>
        {!showDiagram && <div className="rounded-[10px] border-[1.5px] border-[rgb(var(--mg-control))] bg-[rgb(var(--mg-surface))] p-2"><RaceDiagram diagramJson={draft.diagramJson} height={110} /></div>}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" aria-expanded={showDiagram} onClick={() => setShowDiagram(!showDiagram)} className="mg-btn mg-btn-secondary !min-h-11 !rounded-[10px] !px-3.5 !text-[15px]">{showDiagram ? 'Hide diagram editor' : 'Edit diagram'}</button>
          {showDiagram && <button type="button" onClick={() => setShowJson(!showJson)} aria-pressed={showJson} className="mg-small-btn gap-1.5"><Code className="h-4 w-4" aria-hidden="true" />{showJson ? 'Hide JSON' : 'Show JSON'}</button>}
        </div>
        {showDiagram && <DiagramEditor value={draft.diagramJson} onChange={(json) => setDraft({ ...draft, diagramJson: json })} />}
        {showDiagram && showJson && <textarea rows={4} aria-label="Diagram JSON" className="input font-mono text-xs" value={draft.diagramJson} onChange={(e) => setDraft({ ...draft, diagramJson: e.target.value })} />}
      </div>
      {error && <p role="alert" className="mg-notice !bg-[rgb(var(--mg-live-row))] !text-[rgb(var(--mg-elim))]">{error}</p>}
      <div className="flex justify-end gap-3">
        <button type="button" onClick={close} className="mg-btn mg-btn-secondary !min-h-[50px] !rounded-[10px] !px-[18px] !text-base">Cancel</button>
        <button type="submit" disabled={busy} className="mg-btn mg-btn-primary !min-h-[50px] !rounded-[10px] !px-[18px] !text-base">{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );

  return (
    <div className="flex flex-col gap-4">
      {canEdit() && (
        <div className="flex justify-end">
          <button type="button" onClick={startNew} className="mg-btn mg-btn-primary !min-h-[50px] !rounded-[10px] !px-[18px] !text-base"><Plus className="h-[18px] w-[18px]" strokeWidth={2.5} aria-hidden="true" /> New race</button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px]">
        <label className="mg-field !min-h-12">
          <Search className="h-[18px] w-[18px] shrink-0 text-[rgb(var(--mg-faint))]" aria-hidden="true" />
          <span className="sr-only">Search races</span>
          <input type="search" placeholder="Name, category or rule text" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <FieldDrop label="Category" value={category} onChange={setCategory} className="[&>button]:!min-h-12"
          options={[{ value: ALL, label: 'All categories' }, ...categories.map((c) => ({ value: c, label: c }))]} />
      </div>

      <div className="mg-card overflow-visible">
        {draft && draft.id == null && editor(null)}
        {shown.length === 0 && !(draft && draft.id == null) && (
          <p className="px-4 py-3 text-sm text-[rgb(var(--mg-muted))]">{list.length === 0 ? 'No races yet.' : 'No races match that search.'}</p>
        )}
        <ul>
          {shown.map((r, i) => {
            const isOpen = openId === r.id;
            return (
              <li key={r.id} className={i || (draft && draft.id == null) ? 'border-t border-[rgb(var(--mg-rule-soft))]' : ''}>
                <button type="button" aria-expanded={isOpen} onClick={() => open(r)} className="grid min-h-[60px] w-full grid-cols-[minmax(0,1fr)_20px] items-center gap-x-3 py-1.5 pl-4 pr-3.5 text-left hover:bg-[rgb(var(--mg-subtle))] sm:grid-cols-[minmax(0,1fr)_120px_20px]">
                  <span className="flex min-w-0 flex-col gap-[3px]">
                    <strong className="flex items-center gap-1.5 text-base font-semibold">{r.name}{r.isBuiltIn && <Lock className="h-3 w-3 text-[rgb(var(--mg-faint))]" aria-label="Built-in race" />}</strong>
                    <span className="truncate text-[13px] text-[rgb(var(--mg-muted))]">{r.summary}</span>
                  </span>
                  <span className="hidden text-[13px] text-[rgb(var(--mg-muted))] sm:block">{r.category?.trim() || 'Other'}</span>
                  <ChevronDown className={`h-4 w-4 text-[rgb(var(--mg-faint))] ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
                {isOpen && (draft && draft.id === r.id ? editor(r) : (
                  <div className="flex flex-col gap-3 bg-[rgb(var(--mg-subtle))] px-4 pb-4 pt-3 shadow-[inset_3px_0_0_rgb(var(--mg-heading))]">
                    <RaceDiagram diagramJson={r.diagramJson} height={130} />
                    {r.rules ? <p className="whitespace-pre-wrap text-sm">{r.rules}</p> : <p className="text-sm text-[rgb(var(--mg-muted))]">No rules written yet.</p>}
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      </div>
      {list.length > 0 && <p className="mg-meta">{list.length} races in the library</p>}
      {error && !draft && <p role="alert" className="mg-notice !bg-[rgb(var(--mg-live-row))] !text-[rgb(var(--mg-elim))]">{error}</p>}
    </div>
  );
}
