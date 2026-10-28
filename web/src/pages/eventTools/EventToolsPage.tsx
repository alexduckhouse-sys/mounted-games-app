import { useT } from '../../i18n/LanguageContext';
import { ArchiveDownload } from './ArchiveDownload';
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Upload } from 'lucide-react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import { tr } from '../../i18n/translate';
import { Notice } from '../../components/Notice';
import { useToast } from '../../components/Toast';
import { Chevron, RefineFoot, RefineList, RefineNote, RefineSection, RefineStatus } from '../refine/Refine';
import type { CloneCompetitionResult, CsvTeamImportPreview } from './eventToolsTypes';
import './eventTools.css';

export interface CompetitionForTools {
  id: number;
  name: string;
  startDate?: string | null;
  endDate?: string | null;
}

function message(error: unknown, fallback: string) {
  const candidate = error as { response?: { data?: { detail?: string; title?: string } } };
  return candidate.response?.data?.detail ?? candidate.response?.data?.title ?? fallback;
}

function localInput(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default function EventToolsPage() {
  const { competitionId = '' } = useParams();
  return <Navigate to={`/competitions/${competitionId}/operations`} replace />;
}

export function TeamImportPanel({ competitionId, onImported }: { competitionId: string; onImported?: () => void }) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState('club,suffix,section\n');
  const [preview, setPreview] = useState<CsvTeamImportPreview | null>(null);
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryPreview, setRetryPreview] = useState(false);
  const toast = useToast();

  function changeCsv(value: string) {
    setCsv(value); setPreview(null);
  }

  async function loadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try { changeCsv(await file.text()); }
    catch { setError(t('ops3.import.readError')); }
  }

  async function previewImport() {
    setBusy('preview'); setError(null); setRetryPreview(false);
    try {
      const { data } = await api.post<CsvTeamImportPreview>(`/event-tools/competitions/${competitionId}/team-import/preview`, { csv });
      setPreview(data);
    } catch (caught) { setError(message(caught, t('ops3.import.previewError'))); setRetryPreview(true); }
    finally { setBusy(null); }
  }

  async function applyImport() {
    if (!preview) return;
    setBusy('apply'); setError(null); setRetryPreview(false);
    try {
      const { data } = await api.post<{ createdCount: number }>(`/event-tools/competitions/${competitionId}/team-import/apply`, {
        csv, fingerprint: preview.fingerprint, previewVersion: preview.previewVersion,
      });
      toast.show(t('ops3.import.teamsAdded', { count: data.createdCount }));
      setPreview(null);
      onImported?.();
    } catch (caught) {
      setError(message(caught, t('ops3.import.applyError')));
      setPreview(null);
    } finally { setBusy(null); }
  }

  const hasErrors = preview?.rows.some((row) => row.errors.length > 0) ?? false;

  return (
    <section aria-labelledby="import-title">
      {error && <Notice className="tools-msg" actionLabel={retryPreview ? t('common.tryAgain') : undefined} onAction={() => void previewImport()}>{error}</Notice>}
      {toast.node}
      <RefineSection title={t('ops3.import.title')} />
      <h2 id="import-title" className="sr-only">{t('ops3.import.title')}</h2>
      <RefineNote>{t('ops3.import.columns')}<strong>club</strong>, <strong>suffix</strong>, <strong>section</strong>.</RefineNote>
      <RefineList as="div">
        <button type="button" className="rf-row" onClick={() => fileRef.current?.click()}>
          <Upload className="h-5 w-5 rf-chev" aria-hidden="true" /><span className="rf-grow rf-t1">{t('ops3.import.choose')}</span><Chevron />
        </button>
      </RefineList>
      <input ref={fileRef} className="sr-only" type="file" accept=".csv,text/csv" onChange={loadFile} tabIndex={-1} aria-label={t('ops3.import.fileLabel')} />
      <div className="tools-form">
        <label className="rf-fld">{t('ops3.import.csvText')}<textarea className="tools-csv" value={csv} onChange={(event) => changeCsv(event.target.value)} spellCheck={false} /></label>
        <button type="button" className="rf-btn rf-btn-primary rf-wide" disabled={busy !== null || !csv.trim()} onClick={previewImport}>{busy === 'preview' ? t('ops3.import.checking') : t('ops3.import.preview')}</button>
      </div>
      {preview && <>
        <RefineSection title={t('ops3.import.previewTitle')} meta={hasErrors ? t('ops3.import.fixRows') : t('ops3.import.allReady')} />
        <RefineList as="ul" label={t('ops3.import.rowsReady', { valid: preview.validRows, total: preview.totalRows })}>
          {preview.rows.map((row) => <li key={row.rowNumber} className="rf-row">
            <span className="rf-grow">
              <span className="rf-t1"><span>{row.club}</span> <span>{row.suffix}</span></span>
              <span className="rf-t2">{t('ops3.import.row', { n: row.rowNumber, section: row.section })}</span>
              {row.errors.length > 0 && <span className="rf-t2 tools-error">{row.errors.join(' ')}</span>}
            </span>
            {row.errors.length > 0 ? <RefineStatus tone="bad">{t('ops3.import.fix')}</RefineStatus> : <RefineStatus tone="ok">{t('ops3.import.ready')}</RefineStatus>}
          </li>)}
        </RefineList>
        <RefineFoot label={t('ops3.import.addTeams')}>
          <button type="button" className="rf-btn rf-btn-primary rf-wide" disabled={hasErrors || busy !== null} onClick={applyImport}>{busy === 'apply' ? t('ops3.import.adding') : t('ops3.import.addN', { count: preview.validRows })}</button>
        </RefineFoot>
      </>}
    </section>
  );
}

export function DuplicateEventPanel({ competition }: { competition: CompetitionForTools }) {
  const t = useT();
  const [cloneName, setCloneName] = useState(t('ops3.dup.copy', { name: competition.name }));
  const [cloneStart, setCloneStart] = useState(() => localInput(competition.startDate));
  const [cloneEnd, setCloneEnd] = useState(() => localInput(competition.endDate));
  const [cloneResult, setCloneResult] = useState<CloneCompetitionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function cloneCompetition(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null); setCloneResult(null);
    try {
      const startIso = cloneStart ? new Date(cloneStart).toISOString() : new Date().toISOString();
      const { data } = await api.post<CloneCompetitionResult>(`/event-tools/competitions/${competition.id}/clone`, {
        name: cloneName, startDate: startIso, endDate: cloneEnd ? new Date(cloneEnd).toISOString() : null,
      });
      setCloneResult(data); toast.show(t('ops3.dup.ready', { name: data.name }));
    } catch (caught) { setError(message(caught, t('ops3.dup.error'))); }
    finally { setBusy(false); }
  }

  return (
    <section aria-labelledby="duplicate-title">
      {error && <Notice className="tools-msg">{error}</Notice>}
      {toast.node}
      <RefineSection title={t('ops3.dup.title')} />
      <h2 id="duplicate-title" className="sr-only">{t('ops3.dup.title')}</h2>
      <RefineNote>{t('ops3.dup.note')}</RefineNote>
      <form className="tools-form" onSubmit={cloneCompetition}><fieldset disabled={busy} className="tools-fields"><legend className="sr-only">{t('ops3.dup.legend')}</legend>
        <label className="rf-fld">{t('ops3.dup.name')}<input value={cloneName} onChange={(event) => setCloneName(event.target.value)} maxLength={200} required /></label>
        <label className="rf-fld">{t('ops3.dup.starts')}<input type="datetime-local" value={cloneStart} onChange={(event) => setCloneStart(event.target.value)} required /></label>
        <label className="rf-fld">{t('ops3.dup.ends')}<input type="datetime-local" value={cloneEnd} onChange={(event) => setCloneEnd(event.target.value)} /></label>
        <button className="rf-btn rf-btn-primary rf-wide">{busy ? t('ops3.dup.duplicating') : t('ops3.dup.button')}</button>
      </fieldset></form>
      {cloneResult && <>
        <RefineSection title={t('ops3.dup.newEvent')} />
        <RefineList as="div">
          <Link className="rf-row" to={`/admin/competitions/${cloneResult.competitionId}`}>
            <span className="rf-grow"><span className="rf-t1">{cloneResult.name}</span><span className="rf-t2">{t('ops3.dup.copied', { sections: cloneResult.sections, sessions: cloneResult.sessions })}</span></span>
            <span className="rf-st rf-ok">{t('ops3.dup.edit')}</span><Chevron />
          </Link>
        </RefineList>
      </>}
    </section>
  );
}

const PRINT_SHEETS = [
  { to: 'entries', get title() { return tr('ops3.sheet.entries'); }, get detail() { return tr('ops3.sheet.entriesDetail'); } },
  { to: 'draw', get title() { return tr('ops3.sheet.draw'); }, get detail() { return tr('ops3.sheet.drawDetail'); } },
  { to: 'score-sheets', get title() { return tr('ops3.sheet.scoresheets'); }, get detail() { return tr('ops3.sheet.scoresheetsDetail'); } },
  { to: 'results', get title() { return tr('ops3.sheet.results'); }, get detail() { return tr('ops3.sheet.resultsDetail'); } },
  { to: 'volunteer-card', get title() { return tr('ops3.sheet.volunteer'); }, get detail() { return tr('ops3.sheet.volunteerDetail'); } },
  { to: 'tack-check', get title() { return tr('ops3.sheet.tack'); }, get detail() { return tr('ops3.sheet.tackDetail'); } },
  { to: 'poster', get title() { return tr('ops3.sheet.poster'); }, get detail() { return tr('ops3.sheet.posterDetail'); } },
];

export function PrintSheetsPanel({ competitionId }: { competitionId: string }) {
  const t = useT();
  return (
    <section aria-labelledby="print-title">
      <RefineSection title={t('ops3.sheet.panel')} />
      <h2 id="print-title" className="sr-only">{t('ops3.sheet.panel')}</h2>
      <nav aria-label={t('ops3.sheet.nav')}><RefineList as="div">
        {PRINT_SHEETS.map((sheet) => <Link key={sheet.to} className="rf-row" to={`/event-tools/${competitionId}/print/${sheet.to}`}>
          <span className="rf-grow"><span className="rf-t1">{sheet.title}</span><span className="rf-t2">{sheet.detail}</span></span><Chevron />
        </Link>)}
      </RefineList></nav>
      <RefineSection title={t('ops3.sheet.keep')} />
      <RefineList as="div"><ArchiveDownload competitionId={Number(competitionId)} /></RefineList>
    </section>
  );
}
