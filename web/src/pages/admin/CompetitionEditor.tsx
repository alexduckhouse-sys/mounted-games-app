import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import {
  defaultDraft, firstProblemStep, readDraft, STEP_IDS, validateStep, type CreatorDraft, type Problems, type StepId,
} from '../../lib/creatorDraft';
import { draftFromCompetition, realFixedItems, teamCountsOf } from '../../lib/creatorLoad';
import { useT } from '../../i18n/LanguageContext';
import { activeLocale, tr } from '../../i18n/translate';
import type { MessageKey } from '../../i18n/en';
import { loadRaceTemplates, raceListNames } from '../../lib/raceTemplates';
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
import { CreatorSkeleton } from '../../components/Skeletons';
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
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(activeLocale(), { hour: '2-digit', minute: '2-digit' });
}

const STEP_KEY: Record<StepId, MessageKey> = {
  start: 'admin.accounts.ed.step.start', about: 'admin.accounts.ed.step.about', when: 'admin.accounts.ed.step.when', arenas: 'admin.accounts.ed.step.arenas',
  sections: 'admin.accounts.ed.step.sections', structure: 'admin.accounts.ed.step.structure', races: 'admin.accounts.ed.step.races', dec: 'admin.accounts.ed.step.dec',
  payment: 'admin.accounts.ed.step.payment', review: 'admin.accounts.ed.step.review',
};

/** The line the review step shows about where entry fees are paid out. */
function payoutsText(p: PayoutsTo | null): string {
  if (!p) return tr('admin.accounts.ed.payoutsDefault');
  return p.ready && p.maskedAccount
    ? tr('admin.accounts.ed.payoutsReady', { club: p.clubName, account: p.maskedAccount })
    : tr('admin.accounts.ed.payoutsNotReady', { club: p.clubName });
}

export function CompetitionEditor() {
  const t = useT();
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
  // Which way the step slides in: from the right going on, from the left going back.
  const [slide, setSlide] = useState({ at: position, dir: 1 });
  if (slide.at !== position) setSlide({ at: position, dir: position > slide.at ? 1 : -1 });
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
    loadRaceTemplates().then((list) => { if (!cancelled) setTemplates(raceListNames(list)); }).catch(() => {});
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
      setError({ message: e instanceof Error ? e.message : t('admin.accounts.ed.saveFailed'), competitionId: e instanceof SaveError ? e.competitionId : null });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function discardDraft() {
    if (!(await confirmDialog({ title: t('admin.accounts.ed.discardTitle'), message: t('admin.accounts.ed.discardMessage'), cancelLabel: t('admin.accounts.ed.keepEditing'), confirmLabel: t('admin.accounts.ed.discardDraft'), destructive: true }))) return;
    try { window.localStorage.removeItem(storageKey); } catch { /* ignore */ }
    window.location.reload();
  }

  if (loading) return <CreatorSkeleton label={t('common.loading')} />;
  if (loadFailed && !stored) {
    return (
      <PageProblem title={t('admin.accounts.ed.loadFailed')} primaryLabel={t('common.reload')} onPrimary={() => window.location.reload()} secondaryLabel={t('common.goBack')} onSecondary={() => navigate(-1)}>
        {t('admin.accounts.checkSignal')}
      </PageProblem>
    );
  }

  const props = { draft, change, problems, clear };
  const savedText = savedAt && clockTime(savedAt) ? t('admin.accounts.ed.draftSaved', { time: clockTime(savedAt) }) : '';
  const payoutsToShow = isEdit ? competition?.payoutsTo ?? null : clubPayouts;
  const waitingForCopy = stepId === 'start' && draft.startFrom === 'copy' && !draft.copiedFrom;
  const title = isEdit ? t('admin.accounts.ed.edit') : t('admin.accounts.ed.new');
  const [openBefore, openAfter = ''] = t('admin.accounts.ed.createdOpen', { link: '\u0001' }).split('\u0001');

  return (
    <div ref={pageRef} className="skin cw mx-auto flex w-full max-w-6xl flex-col gap-4 pt-6 sm:pt-10">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex flex-col gap-1.5">
          <h1 className="mg-display text-[34px] font-bold leading-none text-[rgb(var(--mg-heading))] sm:text-[44px]">{title}</h1>
          {savedText && createdId === null && (
            <p className="text-sm font-medium text-[rgb(var(--mg-muted))]">
              {savedText}<span aria-hidden="true"> · </span>
              <button type="button" onClick={discardDraft} className="underline">{t('admin.accounts.ed.discardDraft')}</button>
            </p>
          )}
        </div>
      </div>

      <div className="cw-layout">
        <StepNav steps={steps} current={createdId === null ? position : -1} reached={createdId === null ? reached : steps.length} locked={createdId !== null} onGo={go}
          timetable={isEdit ? null : { available: createdId !== null, current: createdId !== null }} onTimetable={() => undefined} title={title} />
        <div className="cw-main">
          {createdId !== null ? (
            <section aria-label={t('admin.accounts.ed.created')} className="cw-step-in flex flex-col">
              <StepHeading>{t('admin.accounts.ed.created')}</StepHeading>
              <div className="cw-card mt-3"><div className="cw-panel" style={{ alignItems: 'flex-start', gap: 10 }}>
                <span className="mg-display text-[22px] font-bold leading-tight text-[rgb(var(--mg-heading))]">{t('admin.accounts.ed.wantTimetable')}</span>
                <span className="cw-t2">{t('admin.accounts.ed.setUp', { name: draft.name.trim() || t('admin.accounts.ed.yourCompetition') })}</span>
                <div className="cw-acts" style={{ marginTop: 4 }}>
                  <button type="button" className="cw-btn cw-btn-p" onClick={() => navigate(`/competitions/${createdId}/timetable-and-draw`)}>{t('admin.accounts.ed.makeNow')}</button>
                  <button type="button" className="cw-btn" onClick={() => navigate(`/competitions/${createdId}`)}>{t('admin.accounts.ed.later')}</button>
                </div>
              </div></div>
            </section>
          ) : (
            <>
              {draft.copiedFrom && stepId !== 'start' && !isEdit && (
                <p className="cw-note" style={{ margin: '0 2px 4px' }}>
                  {t(!draft.startDate || !draft.endDate ? 'admin.accounts.ed.copiedFromDates' : 'admin.accounts.ed.copiedFrom', { name: draft.copiedFrom })}
                </p>
              )}
              <div key={stepId} className="cw-step-in" data-dir={slide.dir}>
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
                    payoutsText={payoutsText(payoutsToShow)} />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {createdId === null && (
        <footer className="cw-bar">
          {(!mayOrganise || Object.keys(problems).length > 0 || error || (busy && progress)) && (
            <div className="cw-msgs">
              {!mayOrganise && <Notice tone="info">{t('admin.accounts.ed.onlyAdmins')}</Notice>}
              {Object.keys(problems).length > 0 && <Notice>{t('admin.accounts.ed.fixFields')}</Notice>}
              {error && (
                <Notice actionLabel={error.competitionId == null ? t('common.tryAgain') : undefined} onAction={error.competitionId == null ? () => { void create(); } : undefined} actionDisabled={busy}>
                  {error.message}
                  {error.competitionId != null && !isEdit && <> {openBefore}<Link className="underline" to={`/admin/competitions/${error.competitionId}`}>{t('admin.accounts.ed.openToFinish')}</Link>{openAfter}</>}
                </Notice>
              )}
              {busy && progress && <span role="status">{progress}</span>}
            </div>
          )}
          <div className="cw-bar-in">
            <div className="cw-bar-side">
              {position > 0 && (
                <button type="button" onClick={() => go(steps[position - 1])} disabled={busy} className="cw-btn">
                  <ChevronLeft className="h-[18px] w-[18px]" aria-hidden="true" />{t('common.back')}
                </button>
              )}
            </div>
            <span className="cw-count">{t('admin.accounts.ed.stepOf', { n: position + 1, total: steps.length })}</span>
            <div className="cw-bar-side">
              {last
                ? <button type="button" onClick={() => void create()} disabled={busy || !mayOrganise} className="cw-btn cw-btn-p" style={{ minHeight: 48, paddingInline: 24 }}>{busy ? t('common.saving') : isEdit ? t('admin.accounts.ed.saveChanges') : t('admin.accounts.ed.create')}</button>
                : <button type="button" onClick={next} disabled={waitingForCopy} className="cw-btn cw-btn-p" style={{ minHeight: 48, paddingInline: 24 }}>{t('common.next')}<ChevronRight className="h-[18px] w-[18px]" aria-hidden="true" /></button>}
            </div>
          </div>
        </footer>
      )}
      <span className="sr-only" aria-live="polite">{t(STEP_KEY[stepId])}</span>
    </div>
  );
}
