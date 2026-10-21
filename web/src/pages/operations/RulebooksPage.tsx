import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { ExternalLink, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useCompetition } from '../competition/context';
import { RefineFoot, RefineHeader, RefineList, RefineNote, RefinePage, RefineSection, RefineStatus } from '../refine/Refine';
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

  const editing = draft !== null;
  const actions = editing
    ? <button type="button" className="rf-ib" aria-label="Close editor" onClick={() => setDraft(null)} disabled={busy}><X className="h-5 w-5" aria-hidden="true" /></button>
    : canWrite ? <button type="button" className="rf-btn" onClick={() => edit()} disabled={busy}><Plus aria-hidden="true" className="h-4 w-4" />Add rulebook</button> : null;

  return (
    <RefinePage>
      <RefineHeader
        back={`/competitions/${competition.id}`}
        backLabel="Back to event"
        context={competition.name}
        actions={actions}
        title={draft ? (draft.id == null ? 'New rulebook' : 'Edit rulebook') : 'Rulebooks'}
        subtitle={draft ? undefined : 'Rules and event notes published by the organiser.'}
      />

      {error && <p role="alert" className="mg-notice ops-alert">{error} {!draft && <button type="button" className="rf-btn rf-btn-text" onClick={() => void load()}>Try again</button>}</p>}
      {saved && <p role="status" className="rf-note">Rulebook saved.</p>}
      {loading && rulebooks.length === 0 && <p role="status" className="rf-note">Loading rulebooks…</p>}
      {!loading && rulebooks.length === 0 && !draft && !error && <RefineNote>No rulebooks have been published for this competition.</RefineNote>}

      {draft && <RulebookEditor draft={draft} setDraft={setDraft} busy={busy} onSave={save} onCancel={() => setDraft(null)} />}

      {rulebooks.length > 0 && !draft && (
        <>
          {rulebooks.length > 1 && <>
            <RefineSection title="Rulebooks" />
            <RefineList as="div">
              {rulebooks.map((item) => (
                <button key={item.id} type="button" className="rf-row" aria-current={selectedId === item.id ? 'true' : undefined} onClick={() => { setSelectedId(item.id); setDraft(null); setSaved(false); }}>
                  <span className="rf-grow"><span className="rf-t1">{item.title}</span><span className="rf-t2">{item.edition}</span></span>
                  {selectedId === item.id && <RefineStatus tone="ok">Showing</RefineStatus>}
                </button>
              ))}
            </RefineList>
          </>}

          {selected && <article className="rulebook-reader">
            <h2 className="ops-reader-title">{selected.title}</h2>
            <p className="rf-note">{selected.edition} · Updated {new Date(selected.updatedAt).toLocaleDateString('en-GB')}</p>
            {selected.sourceUrl && <RefineList as="div"><a href={selected.sourceUrl} target="_blank" rel="noreferrer" className="rf-row"><span className="rf-grow rf-t1">Source</span><ExternalLink aria-hidden="true" className="h-4 w-4 rf-chev" /></a></RefineList>}
            {canWrite && <div className="rf-actions ops-reader-actions">
              <button type="button" className="rf-btn" aria-label={`Edit ${selected.title}`} onClick={() => edit(selected)} disabled={busy}><Pencil aria-hidden="true" className="h-4 w-4" />Edit</button>
              <button type="button" className="rf-btn ops-danger" aria-label={`Delete ${selected.title}`} onClick={() => void remove(selected)} disabled={busy}><Trash2 aria-hidden="true" className="h-4 w-4" />Delete</button>
            </div>}
            <div className="ops-reader-text">{selected.text}</div>
          </article>}
        </>
      )}
    </RefinePage>
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
    <>
      <form id="rulebook-form" className="ops-form" onSubmit={onSave}>
        <Field label="Title"><input autoFocus maxLength={200} required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></Field>
        <Field label="Edition"><input maxLength={100} required value={draft.edition} onChange={(event) => setDraft({ ...draft, edition: event.target.value })} /></Field>
        <Field label="Source link (optional)"><input type="url" maxLength={2000} placeholder="https://…" value={draft.sourceUrl} onChange={(event) => setDraft({ ...draft, sourceUrl: event.target.value })} /></Field>
        <Field label="Rulebook text"><textarea className="ops-textarea" required maxLength={250000} value={draft.text} onChange={(event) => setDraft({ ...draft, text: event.target.value })} /></Field>
      </form>
      <RefineFoot aboveTabs label="Save rulebook">
        <button type="button" className="rf-btn" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" form="rulebook-form" className="rf-btn rf-btn-primary rf-grow" disabled={busy}>{busy ? 'Saving…' : 'Save rulebook'}</button>
      </RefineFoot>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="rf-fld">{label}{children}</label>;
}
