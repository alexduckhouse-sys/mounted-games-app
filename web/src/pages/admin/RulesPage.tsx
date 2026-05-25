import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Plus, Pencil, Trash2, X, Save, ChevronLeft, Lock, Search, Code } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import type { RaceTemplate } from '../../types';
import { RaceDiagram } from '../../components/RaceDiagram';
import { DiagramEditor } from '../../components/DiagramEditor';

type DraftForm = {
  id: number | null;
  name: string;
  category: string;
  summary: string;
  rules: string;
  diagramJson: string;
};

const EMPTY: DraftForm = { id: null, name: '', category: '', summary: '', rules: '', diagramJson: '[]' };

export function RulesPage() {
  const { canEdit } = useAuth();
  const [list, setList] = useState<RaceTemplate[]>([]);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<DraftForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);

  function load() {
    api.get<RaceTemplate[]>('/race-templates').then((r) => setList(r.data)).catch(() => {});
  }
  useEffect(load, []);

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q.length === 0
      ? list
      : list.filter((r) =>
          r.name.toLowerCase().includes(q)
          || (r.category ?? '').toLowerCase().includes(q)
          || (r.summary ?? '').toLowerCase().includes(q));
    const m = new Map<string, RaceTemplate[]>();
    for (const r of filtered) {
      const key = r.category ?? 'Other';
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [list, search]);

  function startNew() {
    setDraft({ ...EMPTY });
    setError(null);
  }
  function startEdit(r: RaceTemplate) {
    setDraft({
      id: r.id,
      name: r.name,
      category: r.category ?? '',
      summary: r.summary ?? '',
      rules: r.rules ?? '',
      diagramJson: r.diagramJson ?? '[]',
    });
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
      setDraft(null);
      load();
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } | string } }).response?.data;
      setError(typeof msg === 'string' ? msg : msg?.message ?? 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: RaceTemplate) {
    if (!confirm(`Delete "${r.name}"?`)) return;
    try {
      await api.delete(`/race-templates/${r.id}`);
      load();
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } | string } }).response?.data;
      alert(typeof msg === 'string' ? msg : msg?.message ?? 'Could not delete.');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Link to="/admin" className="btn-ghost !py-1.5 !px-2.5 text-sm">
          <ChevronLeft className="w-4 h-4" /> Admin
        </Link>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-brand-600" /> Race rules
        </h1>
        {canEdit() && (
          <button onClick={startNew} className="btn-primary !py-1.5 !px-3 text-sm ml-auto">
            <Plus className="w-4 h-4" /> Add race
          </button>
        )}
      </div>

      <div className="card p-3 flex items-center gap-2">
        <Search className="w-4 h-4 text-slate-400 shrink-0" />
        <input
          className="input !py-1.5 text-sm flex-1"
          placeholder="Search by name, category or text…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="text-xs text-slate-500 shrink-0">{list.length} races</span>
      </div>

      {draft && (
        <form onSubmit={save} className="card p-4 space-y-3 border-l-4 border-brand-500">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-sm flex-1">{draft.id == null ? 'New race' : 'Edit race'}</h2>
            <button type="button" onClick={() => setDraft(null)} className="btn-ghost !py-1 !px-1.5">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs font-semibold">Name</span>
              <input
                className="input mt-1 text-sm"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                required
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold">Category</span>
              <input
                className="input mt-1 text-sm"
                placeholder="e.g. Bending, Equipment, Dismount"
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-semibold">One-line summary</span>
            <input
              className="input mt-1 text-sm"
              value={draft.summary}
              onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold">Rules</span>
            <textarea
              rows={5}
              className="input mt-1 text-sm"
              value={draft.rules}
              onChange={(e) => setDraft({ ...draft, rules: e.target.value })}
            />
          </label>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold">Diagram</span>
              <span className="text-[10px] text-slate-500 font-normal">
                Tap a tool, click the lane to place. Drag elements; they snap to poles / midline / changeover.
              </span>
              <button
                type="button"
                onClick={() => setShowJson((v) => !v)}
                className={`btn-ghost !py-0.5 !px-1.5 text-[10px] ml-auto ${showJson ? 'bg-slate-100 dark:bg-slate-700' : ''}`}
                title="Show / hide the raw JSON for power users"
              >
                <Code className="w-3 h-3" /> {showJson ? 'Hide JSON' : 'Show JSON'}
              </button>
            </div>
            <DiagramEditor
              value={draft.diagramJson}
              onChange={(json) => setDraft({ ...draft, diagramJson: json })}
            />
            {showJson && (
              <textarea
                rows={4}
                className="input mt-2 text-[11px] font-mono"
                value={draft.diagramJson}
                onChange={(e) => setDraft({ ...draft, diagramJson: e.target.value })}
              />
            )}
          </div>
          {error && (
            <div className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/30 p-2 rounded-md">{error}</div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDraft(null)} className="btn-ghost !py-1.5 !px-3 text-xs">Cancel</button>
            <button type="submit" disabled={busy} className="btn-primary !py-1.5 !px-3 text-xs">
              <Save className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}

      {grouped.map(([cat, races]) => (
        <div key={cat} className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-300">{cat}</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {races.map((r) => (
              <div key={r.id} className="card p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-base truncate flex items-center gap-1.5">
                      {r.name}
                      {r.isBuiltIn && (
                        <span title="Built-in race" className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase text-slate-500">
                          <Lock className="w-2.5 h-2.5" /> Built-in
                        </span>
                      )}
                    </h3>
                    {r.summary && <p className="text-xs text-slate-600 dark:text-slate-300">{r.summary}</p>}
                  </div>
                  {canEdit() && (
                    <button onClick={() => startEdit(r)} className="btn-ghost !py-1 !px-1.5" title="Edit">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {canEdit() && !r.isBuiltIn && (
                    <button onClick={() => remove(r)} className="btn-ghost !py-1 !px-1.5 text-rose-500" title="Delete">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <RaceDiagram diagramJson={r.diagramJson} height={130} />
                {r.rules && (
                  <p className="text-xs whitespace-pre-wrap text-slate-700 dark:text-slate-200">{r.rules}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {list.length === 0 && (
        <p className="text-sm text-slate-500">No races yet. Add one above.</p>
      )}
    </div>
  );
}
