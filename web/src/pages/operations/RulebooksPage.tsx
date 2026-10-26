import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronRight, ExternalLink, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useCompetition } from '../competition/context';
import { RaceRulesSheet } from '../../components/RaceRulesSheet';
import { RoundSearch } from '../../components/RoundSearch';
import type { RaceTemplate } from '../../types';
import { RulebooksPage as RaceByRaceRulebooksPage } from '../RulebooksPage';
import { RefineFoot, RefineHeader, RefineList, RefineNote, RefinePage, RefineStatus } from '../refine/Refine';
import type { Rulebook, RulebookSummary } from './types';
import { apiMessage } from './types';
import './operations.css';
import '../../components/sitePages.css';
import '../../components/eventPages.css';
import { confirmDialog } from '../../components/ConfirmDialog';

interface RulebookDraft {
  id: number | null;
  title: string;
  edition: string;
  sourceUrl: string;
  text: string;
}

const emptyDraft: RulebookDraft = { id: null, title: '', edition: '', sourceUrl: '', text: '' };
const readCompetitionContext = useCompetition;

export function RulebooksPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  if (searchParams.get('race')?.trim()) {
    return <RaceByRaceRulebooksPage />;
  }
  return <GlobalRulebooks key={user?.id ?? ''} />;
}

/** Rulebooks are shared by every competition. The list holds titles only; a rulebook's text is fetched when it is opened. */
function GlobalRulebooks() {
  let competition: { id: number; name: string } | null = null;
  try {
    competition = readCompetitionContext().competition;
  } catch {
    competition = null;
  }
  const [tab, setTab] = useState<'rulebooks' | 'races'>('rulebooks');
  const { canEdit } = useAuth();
  const canWrite = canEdit();

  const tabsRow = (
    <div className="sp-seg mt-3" role="tablist" aria-label="Rules and rulebooks">
      <button type="button" role="tab" aria-selected={tab === 'rulebooks'} onClick={() => setTab('rulebooks')}>Rulebooks</button>
      <button type="button" role="tab" aria-selected={tab === 'races'} onClick={() => setTab('races')}>Game rules</button>
    </div>
  );

  const headerFor = (draft: RulebookDraft | null, busy: boolean, onAdd: () => void, onClose: () => void) => {
    const editing = draft !== null;
    const actions = tab === 'rulebooks'
      ? (editing
        ? <button type="button" className="rf-ib" aria-label="Close editor" onClick={onClose} disabled={busy}><X className="h-5 w-5" aria-hidden="true" /></button>
        : canWrite ? <button type="button" className="rf-btn" onClick={onAdd} disabled={busy}><Plus aria-hidden="true" className="h-4 w-4" />Add rulebook</button> : null)
      : null;

    return (
      <>
        <RefineHeader
          back={competition ? `/competitions/${competition.id}` : '/events'}
          backLabel={competition ? 'Back to event' : 'Back to events'}
          context={competition?.name ?? 'Rules & rulebooks'}
          actions={actions}
          title={tab === 'rulebooks' && draft ? (draft.id == null ? 'New rulebook' : 'Edit rulebook') : 'Rules'}
        />
        {!editing && tabsRow}
      </>
    );
  };

  return (
    <RefinePage wide>
      {tab === 'rulebooks' ? (
        <RulebooksPanel renderHeader={({ draft, busy, onAdd, onClose }) => headerFor(draft, busy, onAdd, onClose)} onShowGameRules={() => setTab('races')} />
      ) : (
        <>
          {headerFor(null, false, () => {}, () => {})}
          <GameRulesList />
        </>
      )}
    </RefinePage>
  );
}

/** Every race with its rules: search for one, tap it, and its rules open in a sheet. */
function GameRulesList() {
  const [races, setRaces] = useState<RaceTemplate[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<RaceTemplate[]>('/race-templates')
      .then((r) => { if (!cancelled) setRaces(Array.isArray(r.data) ? r.data : []); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (races ?? []).filter((r) => !q || r.name.toLowerCase().includes(q) || (r.category ?? '').toLowerCase().includes(q))
      .slice().sort((a, b) => a.name.localeCompare(b.name));
  }, [races, search]);

  return (
    <div className="mt-3 flex flex-col gap-2.5">
      <RoundSearch label="Find a race" placeholder="Find a race" value={search} onChange={setSearch} />
      {failed ? <p role="alert" className="mg-notice">Couldn’t load the game rules. Check your connection and try again.</p>
        : races === null ? <p role="status" className="sp-note">Loading the game rules…</p>
          : shown.length === 0 ? <p className="sp-note">{search.trim() ? `No race matches “${search.trim()}”.` : 'No game rules have been added yet.'}</p>
            : (
              <div className="sp-card" role="list" aria-label="Races">
                {shown.map((race) => (
                  <div key={race.id} role="listitem">
                    <button type="button" className="sp-row" onClick={() => setOpen(race.name)}>
                      <span className="sp-grow"><span className="sp-t1 !font-medium">{race.name}</span></span>
                      <ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} />
                    </button>
                  </div>
                ))}
              </div>
            )}
      <RaceRulesSheet raceName={open} open={open != null} onClose={() => setOpen(null)} />
    </div>
  );
}

export function RulebooksPanel({
  renderHeader,
  onShowGameRules,
}: {
  renderHeader?: (controls: { draft: RulebookDraft | null; busy: boolean; onAdd: () => void; onClose: () => void }) => ReactNode;
  /** Lets the empty-list line take you to the Game rules tab. */
  onShowGameRules?: () => void;
} = {}) {
  const { canEdit } = useAuth();
  const canWrite = canEdit();
  const [rulebooks, setRulebooks] = useState<RulebookSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [texts, setTexts] = useState<Record<number, Rulebook>>({});
  const [opening, setOpening] = useState(false);
  const [draft, setDraft] = useState<RulebookDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<RulebookSummary[]>('/rulebooks');
      setRulebooks(data);
      setSelectedId((current) => (current != null && data.some((item) => item.id === current) ? current : null));
    } catch (loadError) {
      setError(apiMessage(loadError, 'Couldn’t load the rulebooks. Try again.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const selected = selectedId != null ? texts[selectedId] ?? null : null;

  /** Fetch one rulebook's text, once; later opens reuse it until it is edited or deleted. */
  async function open(id: number) {
    setSelectedId(id);
    setDraft(null);
    setSaved(false);
    setError(null);
    if (texts[id]) return;
    setOpening(true);
    try {
      const { data } = await api.get<Rulebook>(`/rulebooks/${id}`);
      setTexts((current) => ({ ...current, [id]: data }));
    } catch (openError) {
      setError(apiMessage(openError, 'Couldn’t load this rulebook. Try again.'));
    } finally {
      setOpening(false);
    }
  }

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
        ? await api.post<Rulebook>('/rulebooks', payload)
        : await api.put<Rulebook>(`/rulebooks/${draft.id}`, payload);
      setDraft(null);
      setSaved(true);
      setTexts((current) => ({ ...current, [response.data.id]: response.data }));
      setSelectedId(response.data.id);
      await load();
    } catch (saveError) {
      setError(apiMessage(saveError, 'Couldn’t save this rulebook. Check the details and try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(rulebook: Rulebook) {
    if (busy || !canWrite) return;
    if (!(await confirmDialog({ title: 'Delete this rulebook?', message: `Delete “${rulebook.title}”?`, confirmLabel: 'Delete rulebook', destructive: true }))) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/rulebooks/${rulebook.id}`);
      setDraft(null);
      setSaved(false);
      setSelectedId(null);
      setTexts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => Number(id) !== rulebook.id)));
      await load();
    } catch (deleteError) {
      setError(apiMessage(deleteError, 'Couldn’t delete this rulebook. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {renderHeader
        ? renderHeader({ draft, busy, onAdd: () => edit(), onClose: () => setDraft(null) })
        : canWrite && !draft && (
          <div className="mb-3 flex justify-end">
            <button type="button" className="rf-btn" onClick={() => edit()} disabled={busy}><Plus aria-hidden="true" className="h-4 w-4" />Add rulebook</button>
          </div>
        )}

      {error && <p role="alert" className="mg-notice ops-alert">{error} {!draft && <button type="button" className="rf-btn rf-btn-text" onClick={() => (selectedId != null && !selected ? void open(selectedId) : void load())}>Try again</button>}</p>}
      {saved && <p role="status" className="rf-note">Rulebook saved.</p>}
      {loading && rulebooks.length === 0 && <p role="status" className="rf-note">Loading rulebooks…</p>}
      {!loading && rulebooks.length === 0 && !draft && !error && (
        <RefineNote>
          No rulebook has been added yet.{' '}
          {onShowGameRules ? <>See <button type="button" className="ev-link underline" onClick={onShowGameRules}>Game rules</button> for how each race is ridden.</> : 'Game rules has how each race is ridden.'}
          {canWrite && ' Use Add rulebook to publish one.'}
        </RefineNote>
      )}

      {draft && <RulebookEditor draft={draft} setDraft={setDraft} busy={busy} onSave={save} onCancel={() => setDraft(null)} />}

      {rulebooks.length > 0 && !draft && (
        <div className="mt-3 flex flex-col gap-4 lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start lg:gap-6">
          <RefineList as="div">
            {rulebooks.map((item) => (
              <button key={item.id} type="button" className="rf-row" aria-current={selectedId === item.id ? 'true' : undefined} onClick={() => void open(item.id)}>
                <span className="rf-grow"><span className="rf-t1">{item.title}</span><span className="rf-t2">{item.edition}</span></span>
                {selectedId === item.id && <RefineStatus tone="ok">Showing</RefineStatus>}
              </button>
            ))}
          </RefineList>

          {opening && !selected && <p role="status" className="rf-note">Loading rulebook…</p>}
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
