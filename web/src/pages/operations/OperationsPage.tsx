import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePageWidth } from '../../components/pageWidthState';
import { MoreHorizontal, RefreshCw } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useCompetition } from '../competition/context';
import { CompetitionTeamCard } from '../competition/CompetitionTeamCard';
import { ScorerLinksCard } from '../competition/ScorerLinksCard';
import { Chevron, RefineFoot, RefineHeader, RefineList, RefineNote, RefinePage, RefineSection, RefineSheet } from '../refine/Refine';
import { DrawResult, DrawSettingsForm } from './DrawPreviewView';
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
  if (!user || !canOrganise(competition)) {
    return <div className="mx-auto w-full max-w-4xl py-4 mg-font"><p role="alert" className="mg-card p-4">You don’t have access to competition operations.</p></div>;
  }
  return <OperationsPageContent key={`${competition.id}:${user.id}`} />;
}

type View = 'checks' | 'draw' | 'entries' | 'scorers' | 'tack' | 'passport' | 'import' | 'print' | 'results' | 'duplicate';
type Sheet = 'draw' | null;

const VALID_VIEWS = new Set<View>(['checks', 'draw', 'entries', 'scorers', 'tack', 'passport', 'import', 'print', 'results', 'duplicate']);

function OperationsPageContent() {
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
  const [drawMessage, setDrawMessage] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);

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
      setLoadError(apiMessage(error, 'Couldn’t refresh the readiness checks. Try again.'));
    } finally {
      setLoadingReadiness(false);
    }
  }, [competition.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadReadiness(), 0);
    return () => window.clearTimeout(timer);
  }, [loadReadiness]);

  async function previewDraw(seedText = seed) {
    const parsedSeed = Number(seedText);
    if (sectionId == null || !seedText.trim() || !Number.isSafeInteger(parsedSeed)) {
      setDrawError('Choose a section and enter a whole draw number.');
      return;
    }
    setPreviewing(true);
    setDrawError(null);
    setDrawMessage(null);
    try {
      const { data } = await api.post<DrawPreview>(
        `/competitions/${competition.id}/sections/${sectionId}/draw/preview`,
        { seed: parsedSeed },
      );
      setPreview(data);
      setRound(0);
      setSheet(null);
    } catch (error) {
      setDrawError(apiMessage(error, 'Couldn’t preview this draw. Check the section and try again.'));
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
    setDrawMessage(null);
    try {
      await api.post(
        `/competitions/${competition.id}/sections/${preview.sectionId}/draw/apply`,
        { seed: preview.seed, fingerprint: preview.fingerprint },
      );
      setDrawMessage('Draw applied. The timetable now has these lane assignments.');
      reloadCompetition();
      void loadReadiness();
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      setDrawError(apiMessage(error, status === 409
        ? 'The competition changed after this preview. Preview the draw again.'
        : 'Couldn’t apply the draw. Try again.'));
      if (status === 409) setPreview(null);
    } finally {
      setApplying(false);
    }
  }

  // Changing the section or draw number makes any preview stale, so it is dropped until the next preview.
  function changeSection(id: number) { setSectionId(id); setPreview(null); setDrawMessage(null); }
  function changeSeed(value: string) { setSeed(value); setPreview(null); setDrawMessage(null); }

  const groups = useMemo(() => (readiness ? buildIssueGroups(readiness, competition.id) : []), [readiness, competition.id]);
  const shownView: View = view;
  const back = `/competitions/${competition.id}`;
  const sectionName = (id: number) => competition.sections.find((section) => section.id === id)?.displayName ?? 'Section draw';

  const overflow = (
    <button type="button" className="rf-ib" aria-label="Draw settings" aria-haspopup="dialog" onClick={() => setSheet('draw')}>
      <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
    </button>
  );
  const recheck = (
    <button type="button" className="rf-ib" aria-label={loadingReadiness ? 'Checking…' : 'Recheck'} onClick={() => void loadReadiness()} disabled={loadingReadiness}>
      <RefreshCw className={`h-5 w-5 ${loadingReadiness ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" />
    </button>
  );

  let title = 'Preparations';
  let context = `Organiser · ${competition.name}`;
  let subtitle: string | undefined;
  let actions: ReactNode = recheck;
  if (shownView === 'checks') {
    // The page has no subtitle: the rows say what is left.
  } else if (shownView === 'entries') {
    title = 'Entries';
    context = `Organiser · ${competition.name}`;
    actions = null;
  } else if (shownView === 'scorers') {
    title = 'Scorers & team';
    actions = null;
  } else if (shownView === 'tack') {
    title = 'Tack check';
    actions = null;
  } else if (shownView === 'passport') {
    title = 'Passport check';
    actions = null;
  } else if (shownView === 'import') {
    title = 'Import teams';
    actions = null;
  } else if (shownView === 'print') {
    title = 'Print sheets';
    actions = null;
  } else if (shownView === 'results') {
    title = 'Results book';
    actions = null;
  } else if (shownView === 'duplicate') {
    title = 'Duplicate event';
    actions = null;
  } else if (preview) {
    title = sectionName(preview.sectionId);
    actions = overflow;
    context = 'Organiser · Draw preview';
    subtitle = drawSubtitle(preview);
  } else {
    title = 'Draw';
    actions = null;
  }

  const tabs = [
    { label: 'Preparations', active: shownView === 'checks', onSelect: () => setView('checks') },
    { label: 'Draw', active: shownView === 'draw', onSelect: () => setView('draw') },
    { label: 'Entries', active: shownView === 'entries', onSelect: () => setView('entries') },
    { label: 'Scorers & team', active: shownView === 'scorers', onSelect: () => setView('scorers') },
    { label: 'Tack check', active: shownView === 'tack', onSelect: () => setView('tack') },
    { label: 'Passport check', active: shownView === 'passport', onSelect: () => setView('passport') },
    { label: 'Import teams', active: shownView === 'import', onSelect: () => setView('import') },
    { label: 'Print sheets', active: shownView === 'print', onSelect: () => setView('print') },
    { label: 'Results book', active: shownView === 'results', onSelect: () => setView('results') },
    ...(mayDuplicate ? [{ label: 'Duplicate event', active: shownView === 'duplicate', onSelect: () => setView('duplicate') }] : []),
  ];

  const showDrawFoot = shownView === 'draw' && !!preview;

  return (
    <RefinePage className={wide ? 'ops-wide' : ''}>
      <RefineHeader back={back} backLabel="Back to event" context={context} actions={actions} title={title} subtitle={subtitle} tabs={tabs} tabsLabel="Event tools" tabsKind="tablist" />

      {loadError && (!readiness || shownView !== 'checks') && <p role="alert" className="mg-notice ops-alert">{loadError} <button type="button" className="rf-btn rf-btn-text" onClick={() => void loadReadiness()}>Try again</button></p>}
      {loadingReadiness && !readiness && <p role="status" className="rf-note">Checking competition details…</p>}

      {shownView === 'checks' && readiness && (
        <Preparations readiness={readiness} groups={groups} competitionId={competition.id} refreshFailed={loadError !== null} checkedAt={checkedAt} retrying={loadingReadiness} onRetry={() => void loadReadiness()} onOpen={setView} />
      )}

      {shownView === 'entries' && <EntriesPanel canWrite={canWrite} onTimetableChanged={reloadCompetition} />}

      {shownView === 'scorers' && (
        <div className="space-y-6">
          <ScorerLinksCard competitionId={competition.id} canWrite={canWrite} />
          <CompetitionTeamCard competitionId={competition.id} canWrite={canWrite} />
        </div>
      )}

      {shownView === 'tack' && <TackCheckTab competitionId={String(competition.id)} />}
      {shownView === 'passport' && <PassportCheckTab competitionId={String(competition.id)} />}
      {shownView === 'import' && <TeamImportPanel competitionId={String(competition.id)} onImported={reloadCompetition} />}
      {shownView === 'print' && <PrintSheetsPanel competitionId={String(competition.id)} />}
      {shownView === 'results' && <ResultsBookTab competitionId={String(competition.id)} />}
      {shownView === 'duplicate' && mayDuplicate && <DuplicateEventPanel competition={competition} />}

      {shownView === 'draw' && (
        <section aria-label="Section draw">
          {competition.sections.length === 0 && <RefineNote>Add a section before preparing a draw.</RefineNote>}
          {!preview && sheet !== 'draw' && (
            <DrawSettingsForm sections={competition.sections} sectionId={sectionId} seed={seed} previewing={previewing} onSection={changeSection} onSeed={changeSeed} onPreview={() => void previewDraw()} />
          )}
          {drawError && <p role="alert" className="mg-notice ops-alert">{drawError}</p>}
          {preview && <DrawResult preview={preview} round={round} onRound={setRound} onNewSeed={newSeed} busy={previewing} />}
        </section>
      )}

      {showDrawFoot && preview && (
        <RefineFoot aboveTabs column label="Apply draw">
          {drawMessage && <p role="status" className="ops-toast"><span>{drawMessage}</span><button type="button" className="rf-btn rf-btn-text" onClick={() => setDrawMessage(null)}>Dismiss</button></p>}
          <span className="rf-t2">Replaces lane assignments in unscored sessions. Publishing is a separate step.</span>
          <div className="rf-actions">
            <button type="button" className="rf-btn" onClick={() => { setPreview(null); setDrawMessage(null); setDrawError(null); }}>Discard</button>
            <button type="button" className="rf-btn rf-btn-primary rf-grow" onClick={() => void applyDraw()} disabled={applying || previewing || !canWrite || !preview.fairness.everyTeamAppearsOncePerSession}>
              {applying ? 'Applying…' : 'Apply draw'}
            </button>
          </div>
        </RefineFoot>
      )}

      {sheet === 'draw' && (
        <RefineSheet title="Draw settings" onClose={() => setSheet(null)}>
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
  const base = `/competitions/${competitionId}`;
  const clashes = groups.find((group) => group.id === 'clashes')?.items ?? [];
  const unpaid = readiness.unpaidSignups.length;
  const missing = readiness.missingDeclarations.length;
  const short = readiness.incompleteTeams.length;
  const equipmentDetails = readiness.equipmentIssues.length;
  const acknowledged = new Set(readiness.equipmentChecklist.filter((item) => item.acknowledged).map((item) => item.key));
  const equipmentToCheck = equipmentLines(readiness.equipmentChecklist).filter((line) => !line.keys.every((key) => acknowledged.has(key))).length;
  const toSort = ([
    { key: 'unpaid', count: unpaid, title: 'Entries not paid', to: `${base}/entries` },
    { key: 'missing', count: missing, title: 'Dec forms missing', to: `${base}/entries` },
    { key: 'short', count: short, title: 'Teams short of riders', to: `${base}/teams` },
    { key: 'details', count: equipmentDetails, title: 'Races missing equipment details', to: base },
    { key: 'equipment', count: equipmentToCheck, title: 'Equipment to check', to: `${base}/equipment` },
  ] as PrepRow[]).filter((row) => row.count > 0);
  const manage: Array<{ key: string; title: string; todo: boolean; to?: string; view?: View }> = [
    { key: 'details', title: 'Event details', todo: false, to: `${base}/event-details` },
    { key: 'sections', title: 'Sections and races', todo: false, to: `${base}/sections` },
    { key: 'entries', title: 'Entries and dec forms', todo: unpaid + missing + short > 0, to: `${base}/entries` },
    { key: 'timetable', title: 'Timetable and draw', todo: clashes.length + equipmentDetails > 0, to: `${base}/timetable-and-draw` },
    { key: 'equipment', title: 'Equipment', todo: equipmentToCheck > 0, to: `${base}/equipment` },
    { key: 'sponsors', title: 'Sponsors and sharing', todo: false, to: `${base}/sponsors` },
  ];
  const open = (target: { to?: string; view?: View }, children: ReactNode) => target.to
    ? <Link to={target.to} className="rf-row">{children}</Link>
    : <button type="button" className="rf-row" onClick={() => onOpen(target.view as View)}>{children}</button>;
  return (
    <div className="ops-prep">
      {refreshFailed && (
        <p role="status" className="rf-note ops-warn">
          Couldn’t refresh{checkedAt ? ` · last known ${clock(checkedAt)}` : ''}{' '}
          <button type="button" className="rf-btn rf-btn-text" onClick={onRetry} disabled={retrying}>Retry</button>
        </p>
      )}
      {clashes.length > 0 && <>
        <RefineSection title="Blocking publish" />
        <RefineList as="div">
          {clashes.map((item) => (
            <Link key={item.key} to={item.to} className="rf-row">
              <span className="rf-grow"><span className="rf-t1">{item.title}</span><span className="rf-t2">{item.detail}</span></span>
              <Chev />
            </Link>
          ))}
        </RefineList>
      </>}
      <RefineSection title="To sort" />
      {toSort.length === 0
        ? <RefineNote>Nothing to sort.</RefineNote>
        : (
          <RefineList as="div">
            {toSort.map((row) => <Fragment key={row.key}>{open(row, <>
              <span className="rf-num ops-count">{row.count}</span>
              <span className="rf-grow rf-t1">{row.title}</span>
              <Chev />
            </>)}</Fragment>)}
          </RefineList>
        )}
      <RefineSection title="Manage" />
      <RefineList as="div">
        {manage.map((area) => <Fragment key={area.key}>{open(area, <>
          <span className="rf-grow rf-t1">{area.title}</span>
          {area.todo && <span className="ops-dot" role="img" aria-label="Has jobs to sort" />}
          <Chev />
        </>)}</Fragment>)}
      </RefineList>
    </div>
  );
}
