import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import {
  defaultDraft, firstProblemStep, readDraft, STEP_IDS, validateStep, type CreatorDraft, type Problems, type StepId,
} from '../../lib/creatorDraft';
import { draftFromCompetition, realFixedItems, teamCountsOf } from '../../lib/creatorLoad';
import { loadRaceTemplates } from '../../lib/raceTemplates';
import type { CompetitionDetail, PayoutsTo } from '../../types';
import { AboutStep } from './creator/AboutStep';
import { DecFormStep } from './creator/DecFormStep';
import { PaymentNotesStep } from './creator/PaymentNotesStep';
import { RacesStep } from './creator/RacesStep';
import { ReviewStep } from './creator/ReviewStep';
import { SaveError, saveCreator } from './creator/save';
import { SectionsStep } from './creator/SectionsStep';
import { StepNav } from './creator/StepNav';
import { StructureStep } from './creator/StructureStep';
import { WhenWhereStep } from './creator/WhenWhereStep';
import { confirmDialog } from '../../components/ConfirmDialog';

/** The competition creator: one stepped form for making a competition and for changing one that exists. */

function readStored(key: string): CreatorDraft | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? readDraft(JSON.parse(raw)) : null;
  } catch { return null; }
}

function store(key: string, draft: CreatorDraft) {
  try { window.localStorage.setItem(key, JSON.stringify(draft)); } catch { /* quota */ }
}

function clockTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function CompetitionEditor() {
  const navigate = useNavigate();
  const { canOrganise, user, hasRole } = useAuth();
  const { id } = useParams<{ id: string }>();
  const editingId = id ? parseInt(id, 10) : null;
  const isEdit = editingId != null;
  const storageKey = `competitionEditor:${isEdit ? `edit:${editingId}` : 'new'}`;

  // A saved draft, if there is one, is read once so the first render already has it.
  const [stored] = useState(() => readStored(storageKey));
  const [draft, setDraft] = useState<CreatorDraft>(() => stored ?? defaultDraft());
  const [competition, setCompetition] = useState<CompetitionDetail | null>(null);
  const [loading, setLoading] = useState(isEdit);
  const [loadFailed, setLoadFailed] = useState(false);
  const [problems, setProblems] = useState<Problems>({});
  const [refused, setRefused] = useState(0);
  const [reached, setReached] = useState(() => (isEdit ? STEP_IDS.length - 1 : stored?.step ?? 0));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; competitionId: number | null } | null>(null);
  const [templates, setTemplates] = useState<string[]>([]);
  // Where entry fees are paid out: the event's own club when editing, else the signed-in person's club. Read-only here.
  const [clubPayouts, setClubPayouts] = useState<PayoutsTo | null>(null);
  const clubId = user?.clubId ?? null;
  const [savedAt, setSavedAt] = useState<string | null>(stored?.savedAt ?? null);
  const pageRef = useRef<HTMLDivElement>(null);
  const firstSave = useRef(true);

  // The saved competition: needed in edit mode for what exists (teams, sessions) whether or not there is a local draft.
  useEffect(() => {
    if (!editingId) return;
    let cancelled = false;
    api.get<CompetitionDetail>(`/competitions/${editingId}`)
      .then(({ data }) => {
        if (cancelled) return;
        setCompetition(data);
        if (!stored) setDraft(draftFromCompetition(data));
      })
      .catch(() => { if (!cancelled) setLoadFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [editingId, stored]);

  useEffect(() => {
    let cancelled = false;
    loadRaceTemplates().then((list) => { if (!cancelled) setTemplates(list.map((t) => t.name)); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (isEdit || clubId == null) return;
    let cancelled = false;
    api.get<PayoutsTo>(`/clubs/${clubId}/payouts/summary`)
      .then((r) => { if (!cancelled && typeof r.data?.clubName === 'string') setClubPayouts(r.data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isEdit, clubId]);

  // Autosave on every change. The first run only restores what was there.
  useEffect(() => {
    if (loading) return;
    const stamp = firstSave.current ? stored?.savedAt : new Date().toISOString();
    firstSave.current = false;
    store(storageKey, { ...draft, savedAt: stamp });
    if (stamp) setSavedAt(stamp);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `stored` is only read on the first run.
  }, [storageKey, draft, loading]);

  useEffect(() => {
    if (refused > 0) pageRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [refused]);

  const mayOrganise = canOrganise(isEdit ? { createdByUserId: competition?.createdByUserId ?? null } : undefined);
  const teamCounts = useMemo(() => teamCountsOf(competition), [competition]);
  const real = useMemo(() => realFixedItems(competition), [competition]);

  const change = useCallback((patch: Partial<CreatorDraft>) => setDraft((cur) => ({ ...cur, ...patch })), []);
  const clear = useCallback((key: string) => setProblems((cur) => {
    if (!(key in cur)) return cur;
    const rest = { ...cur };
    delete rest[key];
    return rest;
  }), []);

  const step = STEP_IDS[draft.step];
  const last = draft.step === STEP_IDS.length - 1;

  function go(to: number) {
    setProblems({});
    setError(null);
    setDraft((cur) => ({ ...cur, step: to }));
    setReached((cur) => Math.max(cur, to));
    window.scrollTo?.({ top: 0 });
  }

  function next() {
    const found = validateStep(draft, step);
    setProblems(found);
    if (Object.keys(found).length > 0) { setRefused((n) => n + 1); return; }
    go(draft.step + 1);
  }

  async function create() {
    const bad: StepId | null = firstProblemStep(draft);
    if (bad) {
      setProblems(validateStep(draft, bad));
      setDraft((cur) => ({ ...cur, step: STEP_IDS.indexOf(bad) }));
      setRefused((n) => n + 1);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const savedId = await saveCreator(draft, { editingId, competition, teamCounts, progress: setProgress });
      try { window.localStorage.removeItem(storageKey); } catch { /* ignore */ }
      navigate(`/competitions/${savedId}`);
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : 'Could not save.', competitionId: e instanceof SaveError ? e.competitionId : null });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function saveDraft() {
    const stamp = new Date().toISOString();
    store(storageKey, { ...draft, savedAt: stamp });
    setSavedAt(stamp);
  }

  async function discardDraft() {
    if (!(await confirmDialog({ title: 'Discard this draft?', message: 'Discard this saved draft and start over?', confirmLabel: 'Discard draft', destructive: true }))) return;
    try { window.localStorage.removeItem(storageKey); } catch { /* ignore */ }
    window.location.reload();
  }

  if (loading) return <div className="p-6 text-sm text-slate-500">Loading…</div>;
  if (loadFailed && !stored) return <div role="alert" className="p-6 text-sm text-[rgb(var(--mg-elim))]">Could not load competition.</div>;

  const props = { draft, change, problems, clear };
  const savedText = savedAt && clockTime(savedAt) ? `Draft saved ${clockTime(savedAt)}` : '';

  return (
    <div ref={pageRef} className="skin mx-auto flex w-full max-w-5xl flex-col gap-6 pb-40 pt-6 sm:pt-10">
      <div className="flex flex-col gap-2">
        <h1 className="mg-display text-[44px] font-bold leading-none text-[rgb(var(--mg-heading))]">{isEdit ? 'Edit competition' : 'New competition'}</h1>
        {savedText && (
          <p className="text-sm font-medium text-[rgb(var(--mg-muted))]">
            {savedText}{' '}
            <button type="button" onClick={saveDraft} className="underline">Save draft</button>{' '}
            <button type="button" onClick={discardDraft} className="underline">Discard draft</button>
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
        <StepNav current={draft.step} reached={reached} onGo={go} />
        <div className="min-w-0 max-w-[720px]">
          {step === 'about' && <AboutStep {...props} />}
          {step === 'when' && <WhenWhereStep {...props} />}
          {step === 'sections' && <SectionsStep {...props} />}
          {step === 'structure' && <StructureStep {...props} templates={templates} teamCounts={teamCounts} />}
          {step === 'races' && <RacesStep {...props} templates={templates} />}
          {step === 'dec' && <DecFormStep competitionId={isEdit ? editingId : null} canChange={mayOrganise} />}
          {step === 'payment' && <PaymentNotesStep {...props} payoutsTo={isEdit ? competition?.payoutsTo ?? null : clubPayouts} canSetUpPayouts={hasRole('Manager') || hasRole('Admin')} />}
          {step === 'review' && <ReviewStep {...props} teamCounts={teamCounts} real={real} />}
        </div>
      </div>

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-surface))]">
        <div className="mx-auto max-w-5xl px-3 sm:px-4">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 py-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm font-medium text-[rgb(var(--mg-muted))]">
              {!mayOrganise && <span>Only admins and trainers can save changes.</span>}
              {Object.keys(problems).length > 0 && <span role="alert" className="text-[rgb(var(--mg-elim))]">Please fix the highlighted fields.</span>}
              {error && (
                <span role="alert" className="text-[rgb(var(--mg-elim))]">
                  {error.message}
                  {error.competitionId != null && !isEdit && <> The competition was created. <Link className="underline" to={`/admin/competitions/${error.competitionId}`}>Open it to finish</Link>.</>}
                </span>
              )}
              {busy && progress && <span role="status">{progress}</span>}
            </div>
            {draft.step > 0 && <button type="button" onClick={() => go(draft.step - 1)} disabled={busy} className="mg-btn mg-btn-secondary !min-h-12">Back</button>}
            {last
              ? <button type="button" onClick={() => void create()} disabled={busy || !mayOrganise} className="mg-btn mg-btn-primary !min-h-12">{busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create competition'}</button>
              : <button type="button" onClick={next} className="mg-btn mg-btn-primary !min-h-12">Next</button>}
          </div>
        </div>
      </footer>
    </div>
  );
}
