import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import {
  defaultDraft, firstProblemStep, readDraft, STEP_IDS, STEP_LABEL, validateStep, type CreatorDraft, type Problems, type StepId,
} from '../../lib/creatorDraft';
import { draftFromCompetition, realFixedItems, teamCountsOf } from '../../lib/creatorLoad';
import { payoutsLine } from '../../lib/payouts';
import { loadRaceTemplates } from '../../lib/raceTemplates';
import type { CompetitionDetail, PayoutsTo } from '../../types';
import { AboutStep } from './creator/AboutStep';
import { ArenasStep } from './creator/ArenasStep';
import { DecFormStep } from './creator/DecFormStep';
import { PaymentNotesStep } from './creator/PaymentNotesStep';
import { RacesStep } from './creator/RacesStep';
import { ReviewStep } from './creator/ReviewStep';
import { SaveError, saveCreator } from './creator/save';
import { SectionsStep } from './creator/SectionsStep';
import { StartStep } from './creator/StartStep';
import { StepNav } from './creator/StepNav';
import { StepHeading } from './creator/controls';
import { StructureStep } from './creator/StructureStep';
import { WhenWhereStep } from './creator/WhenWhereStep';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Notice } from '../../components/Notice';
import { PageProblem } from '../../components/PageProblem';
import { usePageWidth } from '../../components/pageWidthState';
import './creator/wizard.css';

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
  usePageWidth('wide');
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
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; competitionId: number | null } | null>(null);
  const [templates, setTemplates] = useState<string[]>([]);
  // Where entry fees are paid out: the event's own club when editing, else the signed-in person's club. Read-only here.
  const [clubPayouts, setClubPayouts] = useState<PayoutsTo | null>(null);
  const clubId = user?.clubId ?? null;
  const [savedAt, setSavedAt] = useState<string | null>(stored?.savedAt ?? null);
  // Set once a new competition has been made: the page then offers the timetable.
  const [createdId, setCreatedId] = useState<number | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const firstSave = useRef(true);

  // Editing opens at About: there is nothing to start from.
  const steps = useMemo<StepId[]>(() => (isEdit ? STEP_IDS.filter((s) => s !== 'start') : [...STEP_IDS]), [isEdit]);
  const stepId: StepId = isEdit && STEP_IDS[draft.step] === 'start' ? 'about' : STEP_IDS[draft.step];
  const position = steps.indexOf(stepId);
  const [reached, setReached] = useState(() => (isEdit ? steps.length - 1 : Math.max(0, steps.indexOf(isEdit ? 'about' : STEP_IDS[stored?.step ?? 0]))));

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
    if (loading || createdId !== null) return;
    const stamp = firstSave.current ? stored?.savedAt : new Date().toISOString();
    firstSave.current = false;
    store(storageKey, { ...draft, savedAt: stamp });
    if (stamp) setSavedAt(stamp);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `stored` is only read on the first run.
  }, [storageKey, draft, loading, createdId]);

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

  const last = position === steps.length - 1;

  function go(to: StepId) {
    setProblems({});
    setError(null);
    const at = steps.indexOf(to);
    setDraft((cur) => ({ ...cur, step: STEP_IDS.indexOf(to) }));
    setReached((cur) => Math.max(cur, at));
    window.scrollTo?.({ top: 0 });
  }

  function next() {
    const found = validateStep(draft, stepId);
    setProblems(found);
    if (Object.keys(found).length > 0) { setRefused((n) => n + 1); return; }
    go(steps[position + 1]);
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
      if (isEdit) navigate(`/competitions/${savedId}`);
      else { setCreatedId(savedId); window.scrollTo?.({ top: 0 }); }
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : 'Couldn’t save the competition. Check your signal and try again.', competitionId: e instanceof SaveError ? e.competitionId : null });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function discardDraft() {
    if (!(await confirmDialog({ title: 'Discard this draft?', message: 'You’ll start again from a blank form.', cancelLabel: 'Keep editing', confirmLabel: 'Discard draft', destructive: true }))) return;
    try { window.localStorage.removeItem(storageKey); } catch { /* ignore */ }
    window.location.reload();
  }

  if (loading) return <div className="p-6 text-sm text-slate-500">Loading…</div>;
  if (loadFailed && !stored) {
    return (
      <PageProblem title="Couldn’t load this competition" primaryLabel="Reload page" onPrimary={() => window.location.reload()} secondaryLabel="Go back" onSecondary={() => navigate(-1)}>
        Check your signal and try again.
      </PageProblem>
    );
  }

  const props = { draft, change, problems, clear };
  const savedText = savedAt && clockTime(savedAt) ? `Draft saved ${clockTime(savedAt)}` : '';
  const payoutsToShow = isEdit ? competition?.payoutsTo ?? null : clubPayouts;
  const waitingForCopy = stepId === 'start' && draft.startFrom === 'copy' && !draft.copiedFrom;
  const title = isEdit ? 'Edit competition' : 'New competition';

  return (
    <div ref={pageRef} className="skin cw mx-auto flex w-full max-w-6xl flex-col gap-4 pt-6 sm:pt-10">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex flex-col gap-1.5">
          <h1 className="mg-display text-[34px] font-bold leading-none text-[rgb(var(--mg-heading))] sm:text-[44px]">{title}</h1>
          {savedText && createdId === null && (
            <p className="text-sm font-medium text-[rgb(var(--mg-muted))]">
              {savedText}<span aria-hidden="true"> · </span>
              <button type="button" onClick={discardDraft} className="underline">Discard draft</button>
            </p>
          )}
        </div>
      </div>

      <div className="cw-layout">
        <StepNav steps={steps} current={createdId === null ? position : -1} reached={createdId === null ? reached : steps.length} locked={createdId !== null} onGo={go}
          timetable={isEdit ? null : { available: createdId !== null, current: createdId !== null }} onTimetable={() => undefined} title={title} />
        <div className="cw-main">
          {createdId !== null ? (
            <section aria-label="Competition created" className="flex flex-col">
              <StepHeading>Competition created</StepHeading>
              <div className="cw-card mt-3"><div className="cw-panel" style={{ alignItems: 'flex-start', gap: 10 }}>
                <span className="mg-display text-[22px] font-bold leading-tight text-[rgb(var(--mg-heading))]">Want an example timetable?</span>
                <span className="cw-t2">{draft.name.trim() || 'Your competition'} is set up. You don’t need a timetable until nearer the day.</span>
                <div className="cw-acts" style={{ marginTop: 4 }}>
                  <button type="button" className="cw-btn cw-btn-p" onClick={() => navigate(`/competitions/${createdId}/timetable-and-draw`)}>Make one now</button>
                  <button type="button" className="cw-btn" onClick={() => navigate(`/competitions/${createdId}`)}>Later</button>
                </div>
              </div></div>
            </section>
          ) : (
            <>
              {draft.copiedFrom && stepId !== 'start' && !isEdit && (
                <p className="cw-note" style={{ margin: '0 2px 4px' }}>
                  Copied from {draft.copiedFrom}.{!draft.startDate || !draft.endDate ? ' Set the new dates on When and where.' : ''}
                </p>
              )}
              {stepId === 'start' && <StartStep draft={draft} replace={setDraft} />}
              {stepId === 'about' && <AboutStep {...props} />}
              {stepId === 'when' && <WhenWhereStep {...props} />}
              {stepId === 'arenas' && <ArenasStep {...props} />}
              {stepId === 'sections' && <SectionsStep {...props} />}
              {stepId === 'structure' && <StructureStep {...props} templates={templates} teamCounts={teamCounts} />}
              {stepId === 'races' && <RacesStep {...props} templates={templates} />}
              {stepId === 'dec' && <DecFormStep competitionId={isEdit ? editingId : null} canChange={mayOrganise} />}
              {stepId === 'payment' && <PaymentNotesStep {...props} payoutsTo={payoutsToShow} canSetUpPayouts={hasRole('Manager') || hasRole('Admin')} canSetPassportCheck={!isEdit} />}
              {stepId === 'review' && (
                <ReviewStep {...props} teamCounts={teamCounts} real={real} onEdit={go} isEdit={isEdit}
                  payoutsText={payoutsToShow ? payoutsLine(payoutsToShow) : 'Payouts go to your club once it has set them up.'} />
              )}
            </>
          )}
        </div>
      </div>

      {createdId === null && (
        <footer className="cw-bar">
          {(!mayOrganise || Object.keys(problems).length > 0 || error || (busy && progress)) && (
            <div className="cw-msgs">
              {!mayOrganise && <Notice tone="info">Only admins and trainers can save changes.</Notice>}
              {Object.keys(problems).length > 0 && <Notice>Please fix the highlighted fields.</Notice>}
              {error && (
                <Notice actionLabel={error.competitionId == null ? 'Try again' : undefined} onAction={error.competitionId == null ? () => { void create(); } : undefined} actionDisabled={busy}>
                  {error.message}
                  {error.competitionId != null && !isEdit && <> The competition was created. <Link className="underline" to={`/admin/competitions/${error.competitionId}`}>Open it to finish</Link>.</>}
                </Notice>
              )}
              {busy && progress && <span role="status">{progress}</span>}
            </div>
          )}
          <div className="cw-bar-in">
            <div className="cw-bar-side">
              {position > 0 && (
                <button type="button" onClick={() => go(steps[position - 1])} disabled={busy} className="cw-btn">
                  <ChevronLeft className="h-[18px] w-[18px]" aria-hidden="true" />Back
                </button>
              )}
            </div>
            <span className="cw-count">Step {position + 1} of {steps.length}</span>
            <div className="cw-bar-side">
              {last
                ? <button type="button" onClick={() => void create()} disabled={busy || !mayOrganise} className="cw-btn cw-btn-p" style={{ minHeight: 48, paddingInline: 24 }}>{busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create competition'}</button>
                : <button type="button" onClick={next} disabled={waitingForCopy} className="cw-btn cw-btn-p" style={{ minHeight: 48, paddingInline: 24 }}>Next<ChevronRight className="h-[18px] w-[18px]" aria-hidden="true" /></button>}
            </div>
          </div>
        </footer>
      )}
      <span className="sr-only" aria-live="polite">{STEP_LABEL[stepId]}</span>
    </div>
  );
}
