import { useT } from '../../i18n/LanguageContext';
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePageWidth } from '../../components/pageWidthState';
import { MoreHorizontal, RefreshCw } from 'lucide-react';
import { TickerNumber } from '../../components/TickerNumber';
import { Notice } from '../../components/Notice';
import { useToast } from '../../components/Toast';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useCompetition } from '../competition/context';
import { ProtestsPanel } from './ProtestsPanel';
import { CompetitionTeamCard } from '../competition/CompetitionTeamCard';
import { ScorerLinksCard } from '../competition/ScorerLinksCard';
import { Chevron, RefineFoot, RefineHeader, RefineList, RefineNote, RefinePage, RefineSection, RefineSheet } from '../refine/Refine';
import { DrawResult, DrawSettingsForm } from './DrawPreviewView';
import { DrawUndoBanner } from './DrawUndoBanner';
import { EmergencySearch } from './EmergencySearch';
import { VolunteerRota } from './VolunteerRota';
import { EntriesPanel } from './EntriesPanel';
import { equipmentLines } from './equipment';
import { buildIssueGroups, clock, drawSubtitle, type IssueGroup } from './readiness';
import type { CompetitionReadiness, DrawPreview } from './types';
import { apiMessage } from './types';
import { DuplicateEventPanel, PrintSheetsPanel, TeamImportPanel } from '../eventTools/EventToolsPage';
import { TackCheckTab } from '../eventTools/TackCheckTab';
import { PassportCheckTab } from '../eventTools/PassportCheckTab';
import { ResultsBookTab } from '../eventTools/ResultsBookTab';
import './operations.css';

const DESK_QUERY = '(min-width: 1024px)';

/** True on wide screens, where the organiser desk replaces the phone list. Phones (and jsdom) get the phone layout. */
function useWideScreen(): boolean {
  const [wide, setWide] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia(DESK_QUERY).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(DESK_QUERY);
    const update = () => setWide(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return wide;
}

export function OperationsPage() {
  const { competition } = useCompetition();
  const { user, canOrganise } = useAuth();
  const t = useT();
  if (!user || !canOrganise(competition)) {
    return <div className="mx-auto w-full max-w-4xl py-4 mg-font"><Notice>{t('ops.page.noAccess')}</Notice></div>;
  }
  return <OperationsPageContent key={`${competition.id}:${user.id}`} />;
}

type View = 'checks' | 'draw' | 'entries' | 'protests' | 'scorers' | 'volunteers' | 'safety' | 'tack' | 'passport' | 'import' | 'print' | 'results' | 'duplicate';
type Sheet = 'draw' | null;

const VALID_VIEWS = new Set<View>(['checks', 'draw', 'entries', 'protests', 'scorers', 'volunteers', 'safety', 'tack', 'passport', 'import', 'print', 'results', 'duplicate']);

function OperationsPageContent() {
  const t = useT();
  const canWrite = true; // anyone who can organise this competition may change it; the API decides
  const { competition, reload: reloadCompetition } = useCompetition();
  const { hasRole } = useAuth();
  const mayDuplicate = Boolean(hasRole?.('Admin') || hasRole?.('Trainer'));
  const wide = useWideScreen();
  usePageWidth(wide ? 'wide' : 'default');
  const [searchParams] = useSearchParams();
  const [view, setView] = useState<View>(() => {
    const param = searchParams.get('tab') as View | null;
    return param && VALID_VIEWS.has(param) ? param : 'checks';
  });
  const [sheet, setSheet] = useState<Sheet>(null);
  const [readiness, setReadiness] = useState<CompetitionReadiness | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingReadiness, setLoadingReadiness] = useState(true);
  const [sectionId, setSectionId] = useState<number | null>(competition.sections[0]?.id ?? null);
  const [seed, setSeed] = useState('1');
  const [preview, setPreview] = useState<DrawPreview | null>(null);
  const [round, setRound] = useState(0);
  const [drawError, setDrawError] = useState<string | null>(null);
  const toast = useToast();
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [undoVersion, setUndoVersion] = useState(0);

  const loadReadiness = useCallback(async () => {
    setLoadingReadiness(true);
    setLoadError(null);
    try {
      const { data } = await api.get<CompetitionReadiness>(
        `/competitions/${competition.id}/operations/readiness`,
      );
      setReadiness(data);
      setCheckedAt(new Date());
    } catch (error) {
      setLoadError(apiMessage(error, t('ops.page.refreshError')));
    } finally {
      setLoadingReadiness(false);
    }
  }, [competition.id, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadReadiness(), 0);
    return () => window.clearTimeout(timer);
  }, [loadReadiness]);

  async function previewDraw(seedText = seed) {
    const parsedSeed = Number(seedText);
    if (sectionId == null || !seedText.trim() || !Number.isSafeInteger(parsedSeed)) {
      setDrawError(t('ops.page.drawInvalid'));
      return;
    }
    setPreviewing(true);
    setDrawError(null);
    try {
      const { data } = await api.post<DrawPreview>(
        `/competitions/${competition.id}/sections/${sectionId}/draw/preview`,
        { seed: parsedSeed },
      );
      setPreview(data);
      setRound(0);
      setSheet(null);
    } catch (error) {
      setDrawError(apiMessage(error, t('ops.page.previewError')));
    } finally {
      setPreviewing(false);
    }
  }

  function newSeed() {
    const next = String(Math.floor(Math.random() * 90_000) + 10_000);
    setSeed(next);
    void previewDraw(next);
  }

  async function applyDraw() {
    if (!preview || applying || !canWrite) return;
    setApplying(true);
    setDrawError(null);
    try {
      await api.post(
        `/competitions/${competition.id}/sections/${preview.sectionId}/draw/apply`,
        { seed: preview.seed, fingerprint: preview.fingerprint },
      );
      toast.show(t('ops.page.drawApplied'));
      setUndoVersion((n) => n + 1);
      reloadCompetition();
      void loadReadiness();
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      setDrawError(apiMessage(error, status === 409
        ? t('ops.page.applyStale')
        : t('ops.page.applyError')));
      if (status === 409) setPreview(null);
    } finally {
      setApplying(false);
    }
  }

  // Changing the section or draw number makes any preview stale, so it is dropped until the next preview.
  function changeSection(id: number) { setSectionId(id); setPreview(null); }
  function changeSeed(value: string) { setSeed(value); setPreview(null); }

  const groups = useMemo(() => (readiness ? buildIssueGroups(readiness, competition.id) : []), [readiness, competition.id]);
  const shownView: View = view;
  const back = `/competitions/${competition.id}`;
  const sectionName = (id: number) => competition.sections.find((section) => section.id === id)?.displayName ?? t('ops.page.sectionDraw');

  const overflow = (
    <button type="button" className="rf-ib" aria-label={t('ops.page.drawSettings')} aria-haspopup="dialog" onClick={() => setSheet('draw')}>
      <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
    </button>
  );
  const recheck = (
    <button type="button" className="rf-ib" aria-label={loadingReadiness ? t('ops.page.checking') : t('ops.page.recheck')} onClick={() => void loadReadiness()} disabled={loadingReadiness}>
      <RefreshCw className={`h-5 w-5 ${loadingReadiness ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" />
    </button>
  );

  let title = t('ops.view.checks');
  const orgContext = t('ops.page.context', { name: competition.name });
  let context = orgContext;
  let subtitle: string | undefined;
  let actions: ReactNode = recheck;
  if (shownView === 'checks') {
    // The page has no subtitle: the rows say what is left.
  } else if (shownView === 'entries') {
    title = t('ops.view.entries');
    context = orgContext;
    actions = null;
  } else if (shownView === 'protests') {
    title = t('ops.view.protests');
    actions = null;
  } else if (shownView === 'scorers') {
    title = t('ops.view.scorers');
    actions = null;
  } else if (shownView === 'volunteers') {
    title = t('ops.view.volunteers');
    actions = null;
  } else if (shownView === 'safety') {
    title = t('ops.view.safety');
    actions = null;
  } else if (shownView === 'tack') {
    title = t('ops.view.tack');
    actions = null;
  } else if (shownView === 'passport') {
    title = t('ops.view.passport');
    actions = null;
  } else if (shownView === 'import') {
    title = t('ops.view.import');
    actions = null;
  } else if (shownView === 'print') {
    title = t('ops.view.print');
    actions = null;
  } else if (shownView === 'results') {
    title = t('ops.view.results');
    actions = null;
  } else if (shownView === 'duplicate') {
    title = t('ops.view.duplicate');
    actions = null;
  } else if (preview) {
    title = sectionName(preview.sectionId);
    actions = overflow;
    context = t('ops.page.contextDraw');
    subtitle = drawSubtitle(preview);
  } else {
    title = t('ops.view.draw');
    actions = null;
  }

  const tabs = [
    { label: t('ops.view.checks'), active: shownView === 'checks', onSelect: () => setView('checks') },
    { label: t('ops.view.draw'), active: shownView === 'draw', onSelect: () => setView('draw') },
    { label: t('ops.view.entries'), active: shownView === 'entries', onSelect: () => setView('entries') },
    { label: t('ops.view.protests'), active: shownView === 'protests', onSelect: () => setView('protests') },
    { label: t('ops.view.scorers'), active: shownView === 'scorers', onSelect: () => setView('scorers') },
    { label: t('ops.view.volunteers'), active: shownView === 'volunteers', onSelect: () => setView('volunteers') },
    { label: t('ops.view.safety'), active: shownView === 'safety', onSelect: () => setView('safety') },
    { label: t('ops.view.tack'), active: shownView === 'tack', onSelect: () => setView('tack') },
    { label: t('ops.view.passport'), active: shownView === 'passport', onSelect: () => setView('passport') },
    { label: t('ops.view.import'), active: shownView === 'import', onSelect: () => setView('import') },
    { label: t('ops.view.print'), active: shownView === 'print', onSelect: () => setView('print') },
    { label: t('ops.view.results'), active: shownView === 'results', onSelect: () => setView('results') },
    ...(mayDuplicate ? [{ label: t('ops.view.duplicate'), active: shownView === 'duplicate', onSelect: () => setView('duplicate') }] : []),
  ];

  const showDrawFoot = shownView === 'draw' && !!preview;

  return (
    <RefinePage className={wide ? 'ops-wide' : ''}>
      {toast.node}
      <RefineHeader back={back} backLabel={t('ops.page.backToEvent')} context={context} actions={actions} title={title} subtitle={subtitle} tabs={tabs} tabsLabel={t('ops.page.eventTools')} tabsKind="tablist" />

      <DrawUndoBanner competitionId={competition.id} version={undoVersion} onRestored={() => { reloadCompetition(); void loadReadiness(); }} />

      {loadError && (!readiness || shownView !== 'checks') && <Notice actionLabel={t('common.tryAgain')} onAction={() => void loadReadiness()}>{loadError}</Notice>}
      {loadingReadiness && !readiness && <p role="status" className="rf-note">{t('ops.page.checkingDetails')}</p>}

      {shownView === 'checks' && readiness && (
        <Preparations readiness={readiness} groups={groups} competitionId={competition.id} refreshFailed={loadError !== null} checkedAt={checkedAt} retrying={loadingReadiness} onRetry={() => void loadReadiness()} onOpen={setView} />
      )}

      {shownView === 'entries' && <EntriesPanel canWrite={canWrite} onTimetableChanged={reloadCompetition} />}

      {shownView === 'protests' && (
        <ProtestsPanel competitionId={competition.id} title={t('ops.page.protestsTitle')}
          empty={t('ops.page.protestsEmpty')} />
      )}

      {shownView === 'scorers' && (
        <div className="space-y-3 ops-tools">
          <ScorerLinksCard competitionId={competition.id} canWrite={canWrite} />
          <CompetitionTeamCard competitionId={competition.id} canWrite={canWrite} />
        </div>
      )}

      {shownView === 'volunteers' && <VolunteerRota competition={competition} manage={canWrite} />}
      {shownView === 'safety' && <EmergencySearch competitionId={competition.id} />}

      {shownView === 'tack' && <div className="ops-tools ops-flat"><TackCheckTab competitionId={String(competition.id)} /></div>}
      {shownView === 'passport' && <div className="ops-tools ops-flat"><PassportCheckTab competitionId={String(competition.id)} /></div>}
      {shownView === 'import' && <TeamImportPanel competitionId={String(competition.id)} onImported={reloadCompetition} />}
      {shownView === 'print' && <div className="ops-tools ops-flat"><PrintSheetsPanel competitionId={String(competition.id)} /></div>}
      {shownView === 'results' && <div className="ops-tools ops-flat"><ResultsBookTab competitionId={String(competition.id)} /></div>}
      {shownView === 'duplicate' && mayDuplicate && <DuplicateEventPanel competition={competition} />}

      {shownView === 'draw' && (
        <section aria-label={t('ops.page.sectionDraw')}>
          {competition.sections.length === 0 && <RefineNote>{t('ops.page.addSectionFirst')}</RefineNote>}
          {!preview && sheet !== 'draw' && (
            <DrawSettingsForm sections={competition.sections} sectionId={sectionId} seed={seed} previewing={previewing} onSection={changeSection} onSeed={changeSeed} onPreview={() => void previewDraw()} />
          )}
          {drawError && <Notice>{drawError}</Notice>}
          {preview && <DrawResult preview={preview} round={round} onRound={setRound} onNewSeed={newSeed} busy={previewing} />}
        </section>
      )}

      {showDrawFoot && preview && (
        <RefineFoot aboveTabs column label={t('ops.page.applyDraw')}>
          <span className="rf-t2">{t('ops.page.applyNote')}</span>
          <div className="rf-actions">
            <button type="button" className="rf-btn" onClick={() => { setPreview(null); setDrawError(null); }}>{t('ops.page.discard')}</button>
            <button type="button" className="rf-btn rf-btn-primary rf-grow" onClick={() => void applyDraw()} disabled={applying || previewing || !canWrite || !preview.fairness.everyTeamAppearsOncePerSession}>
              {applying ? t('ops.page.applying') : t('ops.page.applyDraw')}
            </button>
          </div>
        </RefineFoot>
      )}

      {sheet === 'draw' && (
        <RefineSheet title={t('ops.page.drawSettings')} onClose={() => setSheet(null)}>
          <DrawSettingsForm sections={competition.sections} sectionId={sectionId} seed={seed} previewing={previewing} onSection={changeSection} onSeed={changeSeed} onPreview={() => void previewDraw()} />
        </RefineSheet>
      )}
    </RefinePage>
  );
}

interface PrepRow { key: string; count: number; title: string; to?: string; view?: View }

function Chev() { return <Chevron />; }

/** The Preparations list: what is left to sort (rows with a zero count are hidden), then the places each set-up area is managed. */
function Preparations({ readiness, groups, competitionId, refreshFailed, checkedAt, retrying, onRetry, onOpen }: {
  readiness: CompetitionReadiness;
  groups: IssueGroup[];
  competitionId: number;
  refreshFailed: boolean;
  checkedAt: Date | null;
  retrying: boolean;
  onRetry: () => void;
  onOpen: (view: View) => void;
}) {
  const t = useT();
  const base = `/competitions/${competitionId}`;
  const clashes = groups.find((group) => group.id === 'clashes')?.items ?? [];
  const unpaid = readiness.unpaidSignups.length;
  const missing = readiness.missingDeclarations.length;
  const short = readiness.incompleteTeams.length;
  const equipmentDetails = readiness.equipmentIssues.length;
  const acknowledged = new Set(readiness.equipmentChecklist.filter((item) => item.acknowledged).map((item) => item.key));
  const equipmentToCheck = equipmentLines(readiness.equipmentChecklist).filter((line) => !line.keys.every((key) => acknowledged.has(key))).length;
  const toSort = ([
    { key: 'unpaid', count: unpaid, title: t('ops.prep.unpaid'), to: `${base}/entries` },
    { key: 'missing', count: missing, title: t('ops.prep.missing'), to: `${base}/entries` },
    { key: 'short', count: short, title: t('ops.prep.short'), to: `${base}/teams` },
    { key: 'details', count: equipmentDetails, title: t('ops.prep.details'), to: base },
    { key: 'equipment', count: equipmentToCheck, title: t('ops.prep.equipment'), to: `${base}/equipment` },
  ] as PrepRow[]).filter((row) => row.count > 0);
  const manage: Array<{ key: string; title: string; todo: boolean; to?: string; view?: View }> = [
    { key: 'details', title: t('ops.area.details'), todo: false, to: `${base}/event-details` },
    { key: 'sections', title: t('ops.area.sections'), todo: false, to: `${base}/sections` },
    { key: 'entries', title: t('ops.area.entries'), todo: unpaid + missing + short > 0, to: `${base}/entries` },
    { key: 'timetable', title: t('ops.area.timetable'), todo: clashes.length + equipmentDetails > 0, to: `${base}/timetable-and-draw` },
    { key: 'equipment', title: t('ops.area.equipment'), todo: equipmentToCheck > 0, to: `${base}/equipment` },
    { key: 'sponsors', title: t('ops.area.sponsors'), todo: false, to: `${base}/sponsors-and-sharing` },
  ];
  const open = (target: { to?: string; view?: View }, children: ReactNode) => target.to
    ? <Link to={target.to} className="rf-row">{children}</Link>
    : <button type="button" className="rf-row" onClick={() => onOpen(target.view as View)}>{children}</button>;
  return (
    <div className="ops-prep">
      {refreshFailed && (
        <Notice actionLabel={t('common.tryAgain')} onAction={onRetry} actionDisabled={retrying} role="status">
          {t('ops.prep.refreshFailed', { known: checkedAt ? t('ops.prep.lastKnown', { time: clock(checkedAt) }) : '' })}
        </Notice>
      )}
      {clashes.length > 0 && <>
        <RefineSection title={t('ops.prep.blocking')} />
        <RefineList as="div">
          {clashes.map((item) => (
            <Link key={item.key} to={item.to} className="rf-row">
              <span className="rf-grow"><span className="rf-t1">{item.title}</span><span className="rf-t2">{item.detail}</span></span>
              <Chev />
            </Link>
          ))}
        </RefineList>
      </>}
      <RefineSection title={t('ops.prep.toSort')} />
      {toSort.length === 0
        ? <RefineNote>{t('ops.prep.nothing')}</RefineNote>
        : (
          <RefineList as="div">
            {toSort.map((row) => <Fragment key={row.key}>{open(row, <>
              <span className="rf-num ops-count"><TickerNumber value={row.count} format={String} /></span>
              <span className="rf-grow rf-t1">{row.title}</span>
              <Chev />
            </>)}</Fragment>)}
          </RefineList>
        )}
      <RefineSection title={t('ops.prep.manage')} />
      <RefineList as="div">
        {manage.map((area) => <Fragment key={area.key}>{open(area, <>
          <span className="rf-grow rf-t1">{area.title}</span>
          {area.todo && <span className="ops-dot" role="img" aria-label={t('ops.prep.dot')} />}
          <Chev />
        </>)}</Fragment>)}
      </RefineList>
    </div>
  );
}
