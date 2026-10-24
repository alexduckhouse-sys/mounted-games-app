import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePageWidth } from '../../components/pageWidthState';
import { MoreHorizontal } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useCompetition } from '../competition/context';
import { CompetitionTeamCard } from '../competition/CompetitionTeamCard';
import { ScorerLinksCard } from '../competition/ScorerLinksCard';
import { Chevron, RefineDisclosure, RefineFoot, RefineHeader, RefineList, RefineNote, RefinePage, RefineSection, RefineSheet } from '../refine/Refine';
import { DrawResult, DrawSettingsForm } from './DrawPreviewView';
import { EntriesPanel } from './EntriesPanel';
import { EquipmentList } from './EquipmentList';
import { ReadinessDesk } from './ReadinessDesk';
import { buildIssueGroups, clock, drawSubtitle, plural, type IssueGroup } from './readiness';
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

type View = 'checks' | 'equipment' | 'draw' | 'entries' | 'scorers' | 'tack' | 'passport' | 'import' | 'print' | 'results' | 'duplicate';
type Sheet = 'more' | 'draw' | null;

const VALID_VIEWS = new Set<View>(['checks', 'equipment', 'draw', 'entries', 'scorers', 'tack', 'passport', 'import', 'print', 'results', 'duplicate']);

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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadingReadiness, setLoadingReadiness] = useState(true);
  const [savingChecklist, setSavingChecklist] = useState(false);
  const [checkedEquipment, setCheckedEquipment] = useState<Set<string>>(new Set());
  const [checklistSaved, setChecklistSaved] = useState(false);
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
    setChecklistSaved(false);
    setSaveError(null);
    try {
      const { data } = await api.get<CompetitionReadiness>(
        `/competitions/${competition.id}/operations/readiness`,
      );
      setReadiness(data);
      setCheckedAt(new Date());
      setCheckedEquipment(new Set(data.equipmentChecklist.filter((item) => item.acknowledged).map((item) => item.key)));
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

  async function saveChecklist() {
    if (!readiness || savingChecklist || !canWrite) return;
    setSavingChecklist(true);
    setSaveError(null);
    setChecklistSaved(false);
    try {
      const { data } = await api.put<CompetitionReadiness>(
        `/competitions/${competition.id}/operations/equipment-acknowledgements`,
        {
          acknowledgedKeys: Array.from(checkedEquipment),
          expectedFingerprint: readiness.equipmentFingerprint,
        },
      );
      setReadiness(data);
      setCheckedEquipment(new Set(data.equipmentChecklist.filter((item) => item.acknowledged).map((item) => item.key)));
      setChecklistSaved(true);
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      setSaveError(apiMessage(error, status === 409
        ? 'The checklist changed on another device. Refresh before saving again.'
        : 'Couldn’t save the equipment checklist. Try again.'));
    } finally {
      setSavingChecklist(false);
    }
  }

  function toggleEquipment(key: string, value: boolean) {
    setCheckedEquipment((current) => {
      const next = new Set(current);
      if (value) next.add(key); else next.delete(key);
      return next;
    });
    setChecklistSaved(false);
  }

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
  const shownView: View = wide && view === 'equipment' ? 'checks' : view;
  const back = `/competitions/${competition.id}`;
  const equipmentTotal = readiness?.equipmentChecklist.length ?? 0;
  const sectionName = (id: number) => competition.sections.find((section) => section.id === id)?.displayName ?? 'Section draw';

  const overflow = (
    <button type="button" className="rf-ib" aria-label="More actions" aria-haspopup="dialog" onClick={() => setSheet(shownView === 'draw' ? 'draw' : 'more')}>
      <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
    </button>
  );

  let title = 'Readiness';
  let context = `Organiser · ${competition.name}`;
  let subtitle: string | undefined;
  let actions: ReactNode = overflow;
  if (shownView === 'checks') {
    const issues = groups.reduce((sum, group) => sum + group.items.length, 0);
    const time = clock(checkedAt);
    if (readiness) {
      subtitle = [
        readiness.isReady ? 'Ready to publish' : 'Not ready to publish',
        loadError ? `couldn’t refresh, last checked ${time}` : `checked ${time}`,
        !readiness.isReady && issues > 0 && wide ? plural(issues, 'open job') : null,
      ].filter(Boolean).join(' · ');
    }
    if (wide) actions = <button type="button" className="rf-btn" onClick={() => void loadReadiness()} disabled={loadingReadiness}>{loadingReadiness ? 'Checking…' : 'Recheck now'}</button>;
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
  } else if (shownView === 'equipment') {
    title = 'Equipment';
    if (readiness) subtitle = `${checkedEquipment.size} of ${equipmentTotal} items checked`;
  } else if (preview) {
    title = sectionName(preview.sectionId);
    context = 'Organiser · Draw preview';
    subtitle = drawSubtitle(preview);
  } else {
    title = 'Draw';
    actions = null;
  }

  const tabs = [
    { label: 'Readiness', active: shownView === 'checks', onSelect: () => setView('checks') },
    ...(wide ? [] : [{ label: 'Equipment', active: shownView === 'equipment', onSelect: () => setView('equipment') }]),
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

  const clashes = groups.find((group) => group.id === 'clashes')?.items.length ?? 0;
  const showFix = shownView === 'checks' && !wide && clashes > 0;
  const showSave = shownView === 'equipment' && !!readiness && equipmentTotal > 0;
  const showDrawFoot = shownView === 'draw' && !!preview;

  return (
    <RefinePage className={wide ? 'ops-wide' : ''}>
      <RefineHeader back={back} backLabel="Back to event" context={context} actions={actions} title={title} subtitle={subtitle} tabs={tabs} tabsLabel="Event tools" tabsKind="tablist" />

      {loadError && (!readiness || shownView !== 'checks') && <p role="alert" className="mg-notice ops-alert">{loadError} <button type="button" className="rf-btn rf-btn-text" onClick={() => void loadReadiness()}>Try again</button></p>}
      {saveError && <p role="alert" className="mg-notice ops-alert">{saveError}</p>}
      {loadingReadiness && !readiness && <p role="status" className="rf-note">Checking competition details…</p>}

      {shownView === 'checks' && readiness && (wide
        ? <ReadinessDesk readiness={readiness} groups={groups} checkedEquipment={checkedEquipment} canWrite={canWrite} saving={savingChecklist} saved={checklistSaved} onToggle={toggleEquipment} onSave={() => void saveChecklist()} />
        : <PhoneChecks readiness={readiness} groups={groups} checkedEquipment={checkedEquipment} refreshFailed={loadError !== null} checkedAt={checkedAt} retrying={loadingReadiness} onRetry={() => void loadReadiness()} onOpenEquipment={() => setView('equipment')} />)}

      {shownView === 'equipment' && readiness && (
        <section aria-label="Equipment checklist">
          <EquipmentList items={readiness.equipmentChecklist} checked={checkedEquipment} canWrite={canWrite} onToggle={toggleEquipment} />
        </section>
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

      {showFix && (
        <RefineFoot aboveTabs label="Fix clashes">
          <Link className="rf-btn rf-btn-primary rf-wide" to={back}>Fix {plural(clashes, 'clash', 'clashes')}</Link>
        </RefineFoot>
      )}
      {showSave && !wide && (
        <RefineFoot aboveTabs label="Save checklist">
          <button type="button" className="rf-btn rf-btn-primary rf-grow" onClick={() => void saveChecklist()} disabled={savingChecklist || !canWrite}>{savingChecklist ? 'Saving…' : 'Save checklist'}</button>
          {checklistSaved && <span role="status" className="rf-t2">Checklist saved.</span>}
        </RefineFoot>
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

      {sheet === 'more' && (
        <RefineSheet title="More" onClose={() => setSheet(null)}>
          <RefineList as="div">
            <button type="button" className="rf-row" onClick={() => { setSheet(null); void loadReadiness(); }} disabled={loadingReadiness}>
              <span className="rf-grow"><span className="rf-t1">Recheck</span><span className="rf-t2">Load the readiness checks again</span></span>
            </button>
          </RefineList>
        </RefineSheet>
      )}
      {sheet === 'draw' && (
        <RefineSheet title="Draw settings" onClose={() => setSheet(null)}>
          <DrawSettingsForm sections={competition.sections} sectionId={sectionId} seed={seed} previewing={previewing} onSection={changeSection} onSeed={changeSeed} onPreview={() => void previewDraw()} />
        </RefineSheet>
      )}
    </RefinePage>
  );
}

function PhoneChecks({ readiness, groups, checkedEquipment, refreshFailed, checkedAt, retrying, onRetry, onOpenEquipment }: {
  readiness: CompetitionReadiness;
  groups: IssueGroup[];
  checkedEquipment: Set<string>;
  refreshFailed: boolean;
  checkedAt: Date | null;
  retrying: boolean;
  onRetry: () => void;
  onOpenEquipment: () => void;
}) {
  const total = readiness.equipmentChecklist.length;
  const checked = checkedEquipment.size;
  const equipmentDone = total === 0 || checked >= total;
  const blocking = groups.filter((group) => group.blocks && group.items.length > 0);
  // A payments group that failed to refresh stays visible with Retry even when it has no known items.
  const before = groups.filter((group) => !group.blocks && (group.items.length > 0 || (refreshFailed && group.id === 'payments')));
  const done: string[] = [
    ...groups.filter((group) => group.items.length === 0 && !(refreshFailed && group.id === 'payments')).map((group) => group.doneText),
    ...(equipmentDone ? [total === 0 ? 'No equipment to check' : `Equipment checklist complete (${checked} of ${total})`] : []),
  ];
  return (
    <>
      {blocking.length > 0 && <>
        <RefineSection title="Blocking publish" />
        <RefineList as="div">{blocking.map((group) => <IssueRow key={group.id} group={group} />)}</RefineList>
      </>}
      {(before.length > 0 || !equipmentDone) && <>
        <RefineSection title="Before the day" />
        <RefineList as="div">
          {before.map((group) => <IssueRow key={group.id} group={group} failed={refreshFailed && group.id === 'payments'} lastKnown={clock(checkedAt)} retrying={retrying} onRetry={onRetry} />)}
          {!equipmentDone && (
            <button type="button" className="rf-row" onClick={onOpenEquipment}>
              <span className="rf-grow"><span className="rf-t1">Equipment checklist</span><span className="rf-t2">Check the arena equipment</span></span>
              <span className="rf-num">{checked}<span className="ops-of">/{total}</span></span>
              <Chevron />
            </button>
          )}
        </RefineList>
      </>}
      {blocking.length === 0 && before.length === 0 && equipmentDone && <RefineNote>All checks are clear.</RefineNote>}
      {done.length > 0 && (
        <div className="ops-gap">
          <RefineList as="div">
            <RefineDisclosure title="Done" trailing={<span className="rf-t2">{done.length}</span>}>
              <ul className="ops-done">{done.map((text) => <li key={text} className="rf-row ops-lane">{text}</li>)}</ul>
            </RefineDisclosure>
          </RefineList>
        </div>
      )}
      <RefineNote>Checks are advisory. They don’t stop you publishing.</RefineNote>
    </>
  );
}

/** One category: a collapsible row with the count on the right, opening to the individual jobs. Red is kept for blockers. */
function IssueRow({ group, failed = false, lastKnown = '', retrying = false, onRetry }: {
  group: IssueGroup;
  failed?: boolean;
  lastKnown?: string;
  retrying?: boolean;
  onRetry?: () => void;
}) {
  const count = group.items.length;
  const number = <span className={`rf-num ${group.blocks ? 'ops-num-bad' : ''}`}>{count}</span>;
  const items = group.items.map((item) => (
    <Link key={item.key} to={item.to} className="rf-row ops-item-row">
      <span className="rf-grow"><span className="rf-t1">{item.title}</span><span className="rf-t2">{item.detail}</span></span>
      <Chevron />
    </Link>
  ));
  if (failed) {
    return (
      <div>
        <div className="rf-row">
          <span className="rf-grow"><span className="rf-t1">{group.title}</span><span className="rf-t2 ops-warn">Couldn’t refresh{lastKnown ? ` · last known ${lastKnown}` : ''}</span></span>
          {number}
          <button type="button" className="rf-btn rf-btn-text" onClick={onRetry} disabled={retrying}>Retry</button>
        </div>
        {items}
      </div>
    );
  }
  return (
    <RefineDisclosure defaultOpen={group.blocks || count <= 3} title={group.title} sub={group.hint} trailing={number}>
      {items}
    </RefineDisclosure>
  );
}
