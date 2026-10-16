import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { BookOpen, ExternalLink, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useCompetition } from '../competition/context';
import type { Rulebook } from './types';
import { apiMessage } from './types';
import './operations.css';

interface RulebookDraft {
  id: number | null;
  title: string;
  edition: string;
  sourceUrl: string;
  text: string;
}

const emptyDraft: RulebookDraft = { id: null, title: '', edition: '', sourceUrl: '', text: '' };

export function RulebooksPage() {
  const { competition } = useCompetition();
  const { user, editorMode } = useAuth();
  return <EventRulebooks key={`${competition.id}:${user?.id ?? ''}:${editorMode}`} />;
}

function EventRulebooks() {
  const { competition } = useCompetition();
  const { canEdit, canOrganise, hasRole } = useAuth();
  const canWrite = hasRole('Admin') ? canEdit() : canOrganise(competition);
  const [rulebooks, setRulebooks] = useState<Rulebook[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<RulebookDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async (preferId?: number) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<Rulebook[]>(`/competitions/${competition.id}/rulebooks`);
      setRulebooks(data);
      setSelectedId((current) => {
        const wanted = preferId ?? current;
        return wanted != null && data.some((item) => item.id === wanted) ? wanted : data[0]?.id ?? null;
      });
    } catch (loadError) {
      setError(apiMessage(loadError, 'Couldn’t load the rulebooks. Try again.'));
    } finally {
      setLoading(false);
    }
  }, [competition.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const selected = useMemo(() => rulebooks.find((item) => item.id === selectedId) ?? null, [rulebooks, selectedId]);

  function edit(rulebook?: Rulebook) {
    setDraft(rulebook ? {
      id: rulebook.id,
      title: rulebook.title,
      edition: rulebook.edition,
      sourceUrl: rulebook.sourceUrl ?? '',
      text: rulebook.text,
    } : { ...emptyDraft });
    setSaved(false);
    setError(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || busy || !canWrite) return;
    if (!draft.title.trim() || !draft.edition.trim() || !draft.text.trim()) {
      setError('Add a title, edition and rulebook text before saving.');
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const payload = {
        title: draft.title.trim(),
        edition: draft.edition.trim(),
        sourceUrl: draft.sourceUrl.trim() || null,
        text: draft.text.trim(),
      };
      const response = draft.id == null
        ? await api.post<Rulebook>(`/competitions/${competition.id}/rulebooks`, payload)
        : await api.put<Rulebook>(`/competitions/${competition.id}/rulebooks/${draft.id}`, payload);
      setDraft(null);
      setSaved(true);
      await load(response.data.id);
    } catch (saveError) {
      setError(apiMessage(saveError, 'Couldn’t save this rulebook. Check the details and try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(rulebook: Rulebook) {
    if (busy || !canWrite || !window.confirm(`Delete “${rulebook.title}”?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/competitions/${competition.id}/rulebooks/${rulebook.id}`);
      setDraft(null);
      setSaved(false);
      await load();
    } catch (deleteError) {
      setError(apiMessage(deleteError, 'Couldn’t delete this rulebook. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ops-page flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="mg-kicker mb-1">{competition.name}</p><h1 className="mg-h1 mg-h1-sm">Rulebooks</h1>
          <p className="mg-meta mt-1">Rules and event notes published by the organiser.</p>
        </div>
        {canWrite && !draft && <button type="button" className="mg-btn mg-btn-primary" onClick={() => edit()} disabled={busy}>
          <Plus aria-hidden="true" className="h-4 w-4" /> Add rulebook
        </button>}
      </div>

      {error && <p role="alert" className="mg-notice">{error} {!draft && <button className="mg-text-link" onClick={() => void load()}>Try again</button>}</p>}
      {saved && <p role="status" className="mg-meta">Rulebook saved.</p>}
      {loading && rulebooks.length === 0 && <p role="status" className="mg-card p-4 text-[rgb(var(--mg-muted))]">Loading rulebooks…</p>}
      {!loading && rulebooks.length === 0 && !draft && <div className="mg-card p-6 text-center"><BookOpen aria-hidden="true" className="mx-auto mb-3 h-8 w-8 text-[rgb(var(--mg-muted))]" /><p>No rulebooks have been published for this competition.</p></div>}

      {draft && <RulebookEditor draft={draft} setDraft={setDraft} busy={busy} onSave={save} onCancel={() => setDraft(null)} />}

      {rulebooks.length > 0 && !draft && (
        <div className="grid gap-4 md:grid-cols-[15rem_minmax(0,1fr)]">
          <label className="md:hidden mg-field"><span className="sr-only">Choose rulebook</span><select value={selectedId ?? ''} onChange={(event) => { setSelectedId(Number(event.target.value)); setSaved(false); }}>{rulebooks.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.edition}</option>)}</select></label>
          <nav className="hidden md:block mg-list self-start" aria-label="Rulebooks">
            {rulebooks.map((item) => (
              <button key={item.id} type="button" className={`mg-row ${selectedId === item.id ? 'bg-[rgb(var(--mg-subtle))]' : ''}`} aria-current={selectedId === item.id ? 'page' : undefined} onClick={() => { setSelectedId(item.id); setDraft(null); setSaved(false); }}>
                <span className="min-w-0"><strong className="block truncate text-[rgb(var(--mg-heading))]">{item.title}</strong><span className="mg-meta block truncate">{item.edition}</span></span>
              </button>
            ))}
          </nav>

          {selected && <article className="rulebook-reader">
            <header className="border-b border-[rgb(var(--mg-rule))] pb-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="mg-h1 mg-h1-sm">{selected.title}</h2>
                  <p className="mg-meta mt-1">{selected.edition} · Updated {new Date(selected.updatedAt).toLocaleDateString('en-GB')}</p>
                </div>
                {canWrite && <div className="flex gap-2">
                  <button type="button" className="mg-icon-btn" aria-label={`Edit ${selected.title}`} onClick={() => edit(selected)} disabled={busy}><Pencil aria-hidden="true" className="h-4 w-4" /></button>
                  <button type="button" className="mg-icon-btn text-red-700" aria-label={`Delete ${selected.title}`} onClick={() => void remove(selected)} disabled={busy}><Trash2 aria-hidden="true" className="h-4 w-4" /></button>
                </div>}
              </div>
              {selected.sourceUrl && <a href={selected.sourceUrl} target="_blank" rel="noreferrer" className="mg-text-link mt-2 justify-start">Source <ExternalLink aria-hidden="true" className="h-4 w-4" /></a>}
            </header>
            <div className="whitespace-pre-wrap py-5 text-base leading-7 text-[rgb(var(--mg-body))]">{selected.text}</div>
          </article>}
        </div>
      )}
    </div>
  );
}

function RulebookEditor({ draft, setDraft, busy, onSave, onCancel }: {
  draft: RulebookDraft;
  setDraft: (draft: RulebookDraft) => void;
  busy: boolean;
  onSave: (event: FormEvent) => void;
  onCancel: () => void;
}) {
  return (
    <form className="flex flex-col gap-4 border-t border-[rgb(var(--mg-rule))] pt-4" onSubmit={onSave}>
      <div className="flex items-center gap-3"><h2 className="mg-h2 flex-1">{draft.id == null ? 'New rulebook' : 'Edit rulebook'}</h2><button type="button" className="mg-icon-btn" aria-label="Close editor" onClick={onCancel} disabled={busy}><X aria-hidden="true" className="h-4 w-4" /></button></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title"><input autoFocus maxLength={200} required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></Field>
        <Field label="Edition"><input maxLength={100} required value={draft.edition} onChange={(event) => setDraft({ ...draft, edition: event.target.value })} /></Field>
      </div>
      <Field label="Source link (optional)"><input type="url" maxLength={2000} placeholder="https://…" value={draft.sourceUrl} onChange={(event) => setDraft({ ...draft, sourceUrl: event.target.value })} /></Field>
      <label className="flex flex-col gap-1.5 text-sm font-semibold text-[rgb(var(--mg-heading))]">Rulebook text<textarea className="min-h-72 rounded-[10px] border-[1.5px] border-[rgb(var(--mg-control))] bg-[rgb(var(--mg-surface))] p-3 text-base font-normal leading-6 text-[rgb(var(--mg-ink))] focus:border-[rgb(var(--mg-heading))] focus:outline-none" required maxLength={250000} value={draft.text} onChange={(event) => setDraft({ ...draft, text: event.target.value })} /></label>
      <div className="ops-save-bar justify-end"><button type="button" className="mg-btn mg-btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button><button type="submit" className="mg-btn mg-btn-primary" disabled={busy}><Save aria-hidden="true" className="h-4 w-4" />{busy ? 'Saving…' : 'Save rulebook'}</button></div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex flex-col gap-1.5 text-sm font-semibold text-[rgb(var(--mg-heading))]">{label}<span className="mg-field">{children}</span></label>;
}
