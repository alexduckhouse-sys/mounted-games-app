import { SaveStartingPoint } from './SaveStartingPoint';
import { OfficialResultsDownload } from './OfficialResultsDownload';
import { useT } from '../../i18n/LanguageContext';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePageWidth } from '../../components/pageWidthState';
import { MoreHorizontal } from 'lucide-react';
import { Notice } from '../../components/Notice';
import { useToast } from '../../components/Toast';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useCompetition } from '../competition/context';
import { ProtestsPanel } from './ProtestsPanel';
import { CompetitionTeamCard } from '../competition/CompetitionTeamCard';
import { ScorerLinksCard } from '../competition/ScorerLinksCard';
import { RefineFoot, RefineHeader, RefineNote, RefinePage, RefineSheet } from '../refine/Refine';
import { DrawResult, DrawSettingsForm } from './DrawPreviewView';
import { DrawUndoBanner } from './DrawUndoBanner';
import { EmergencySearch } from './EmergencySearch';
import { VolunteerRota } from './VolunteerRota';
import { EntriesPanel } from './EntriesPanel';
import { BeforeTheDayHub } from './BeforeTheDayHub';
import { isTool, type Tool } from './hubData';
import { buildIssueGroups, drawSubtitle } from './readiness';
import type { CompetitionReadiness, DrawPreview } from './types';
import { apiMessage } from './types';
import { DuplicateEventPanel, PrintSheetsPanel, TeamImportPanel } from '../eventTools/EventToolsPage';
import { TackCheckTab } from '../eventTools/TackCheckTab';
import { PassportCheckTab } from '../eventTools/PassportCheckTab';
import { ResultsBookTab } from '../eventTools/ResultsBookTab';
import { failedRefreshOutcome, type RefreshOutcome } from '../../lib/refreshOutcome';
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

type Sheet = 'draw' | null;

function OperationsPageContent() {
  const t = useT();
  const canWrite = true; // anyone who can organise this competition may change it; the API decides
  const { competition, reload: reloadCompetition } = useCompetition();
  const { hasRole } = useAuth();
  const mayDuplicate = Boolean(hasRole?.('Admin') || hasRole?.('Trainer'));
  const wide = useWideScreen();
  usePageWidth(wide ? 'wide' : 'default');
  const { tool: toolParam } = useParams();
  const [searchParams] = useSearchParams();
  const tool: Tool | null = isTool(toolParam) ? toolParam : null;
  const [sheet, setSheet] = useState<Sheet>(null);
  const [readiness, setReadiness] = useState<CompetitionReadiness | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingReadiness, setLoadingReadiness] = useState(true);
  const [sectionId, setSectionId] = useState<number | null>(competition.sections[0]?.id ?? null);
  const [seed, setSeed] = useState('1');
  const [preview, setPreview] = useState<DrawPreview | null>(null);
  const [previous, setPrevious] = useState<DrawPreview | null>(null);
  const [round, setRound] = useState(0);
  const [drawError, setDrawError] = useState<string | null>(null);
  const toast = useToast();
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [undoVersion, setUndoVersion] = useState(0);

  const loadReadiness = useCallback(async (): Promise<RefreshOutcome> => {
    setLoadingReadiness(true);
    setLoadError(null);
    try {
      const { data } = await api.get<CompetitionReadiness>(
        `/competitions/${competition.id}/operations/readiness`,
      );
      setReadiness(data);
      setCheckedAt(new Date());
      return 'updated';
    } catch (error) {
      setLoadError(apiMessage(error, t('ops.page.refreshError')));
      return failedRefreshOutcome();
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
      setPrevious(preview);
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
  const hubPath = `/competitions/${competition.id}/operations`;
  const sectionName = (id: number) => competition.sections.find((section) => section.id === id)?.displayName ?? t('ops.page.sectionDraw');

  const overflow = (
    <button type="button" className="rf-ib" aria-label={t('ops.page.drawSettings')} aria-haspopup="dialog" onClick={() => setSheet('draw')}>
      <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
    </button>
  );

  const legacyTab = searchParams.get('tab');
  if (!tool && toolParam) return <Navigate to={hubPath} replace />;
  if (tool === 'duplicate' && !mayDuplicate) return <Navigate to={hubPath} replace />;
  if (!tool && legacyTab) {
    // Old links: ?tab=<view> is now its own page. Unknown values and "checks" land on the hub.
    return <Navigate to={isTool(legacyTab) ? `${hubPath}/${legacyTab}` : hubPath} replace />;
  }

  let title = t('ops.hub.title');
  let context = competition.name;
  let subtitle: string | undefined;
  let actions: ReactNode = null;
  if (tool === 'draw') {
    title = t('ops.view.draw');
    if (preview) {
      title = sectionName(preview.sectionId);
      actions = overflow;
      context = t('ops.page.contextDraw');
      subtitle = drawSubtitle(preview);
    }
  } else if (tool) {
    title = t(`ops.view.${tool}`);
  }

  const showDrawFoot = tool === 'draw' && !!preview;

  return (
    <RefinePage className={wide ? 'ops-wide' : ''}>
      {toast.node}
      <RefineHeader back={tool ? hubPath : `/competitions/${competition.id}`} backLabel={tool ? t('ops.hub.back') : t('ops.page.backToEvent')} context={context} actions={actions}
        onRefresh={tool ? undefined : loadReadiness} refreshLabel={t('ops.page.recheck')} title={title} subtitle={subtitle} />

      <DrawUndoBanner competitionId={competition.id} version={undoVersion} onRestored={() => { reloadCompetition(); void loadReadiness(); }} />

      {loadError && (!readiness || tool !== null) && <Notice actionLabel={t('common.tryAgain')} onAction={() => void loadReadiness()}>{loadError}</Notice>}
      {!tool && loadingReadiness && !readiness && (
        <div role="status" className="ops-skel" aria-busy="true">
          <span className="sr-only">{t('ops.page.checkingDetails')}</span>
          {[0, 1, 2, 3].map((row) => <span key={row} className="mg-skel ops-skel-row" aria-hidden="true" />)}
        </div>
      )}

      {!tool && !(loadingReadiness && !readiness) && (
        <div key="hub" className="ops-fade"><BeforeTheDayHub competition={competition} readiness={readiness} groups={groups} mayDuplicate={mayDuplicate} refreshFailed={loadError !== null && readiness !== null} checkedAt={checkedAt} retrying={loadingReadiness} onRetry={() => void loadReadiness()} /></div>
      )}

      {tool && tool !== 'draw' && <div key={tool} className="ops-fade">
      {tool === 'entries' && <EntriesPanel canWrite={canWrite} onTimetableChanged={reloadCompetition} />}

      {tool === 'protests' && (
        <ProtestsPanel competitionId={competition.id} title={t('ops.page.protestsTitle')}
          empty={t('ops.page.protestsEmpty')} />
      )}

      {tool === 'scorers' && (
        <div className="space-y-3 ops-tools">
          <ScorerLinksCard competitionId={competition.id} canWrite={canWrite} />
          <CompetitionTeamCard competitionId={competition.id} canWrite={canWrite} />
        </div>
      )}

      {tool === 'volunteers' && <VolunteerRota competition={competition} manage={canWrite} />}
      {tool === 'safety' && <EmergencySearch competitionId={competition.id} />}

      {tool === 'tack' && <div className="ops-tools ops-flat"><TackCheckTab competitionId={String(competition.id)} /></div>}
      {tool === 'passport' && <div className="ops-tools ops-flat"><PassportCheckTab competitionId={String(competition.id)} /></div>}
      {tool === 'import' && <TeamImportPanel competitionId={String(competition.id)} onImported={reloadCompetition} />}
      {tool === 'print' && <div className="ops-tools ops-flat"><PrintSheetsPanel competitionId={String(competition.id)} /></div>}
      {tool === 'results' && <div className="ops-tools ops-flat">
        <div className="rf-list"><Link className="rf-row" to={`/competitions/${competition.id}/prize-giving`}>{t('screen.pg.title')}</Link><OfficialResultsDownload competitionId={competition.id} /></div>
        <ResultsBookTab competitionId={String(competition.id)} />
      </div>}
      {tool === 'duplicate' && mayDuplicate && <><DuplicateEventPanel competition={competition} /><div className="rf-list"><SaveStartingPoint competitionId={competition.id} competitionName={competition.name} /></div></>}
      </div>}
      {!tool && mayDuplicate && <div className="rf-list"><SaveStartingPoint competitionId={competition.id} competitionName={competition.name} /></div>}

      {tool === 'draw' && (
        <section aria-label={t('ops.page.sectionDraw')} className="ops-fade">
          {competition.sections.length === 0 && <RefineNote>{t('ops.page.addSectionFirst')}</RefineNote>}
          {!preview && sheet !== 'draw' && (
            <DrawSettingsForm sections={competition.sections} sectionId={sectionId} seed={seed} previewing={previewing} onSection={changeSection} onSeed={changeSeed} onPreview={() => void previewDraw()} />
          )}
          {drawError && <Notice>{drawError}</Notice>}
          {preview && <DrawResult preview={preview} previous={previous} round={round} onRound={setRound} onNewSeed={newSeed} busy={previewing} />}
        </section>
      )}

      {showDrawFoot && preview && (
        <RefineFoot inline aboveTabs column label={t('ops.page.applyDraw')}>
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
