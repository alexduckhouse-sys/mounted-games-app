import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { CheckCircle2, Upload } from 'lucide-react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { api } from '../../api';
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
  const fileRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState('club,suffix,section\n');
  const [preview, setPreview] = useState<CsvTeamImportPreview | null>(null);
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function changeCsv(value: string) {
    setCsv(value); setPreview(null); setSuccess(null);
  }

  async function loadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try { changeCsv(await file.text()); }
    catch { setError('Couldn’t read that file. Try pasting the CSV text instead.'); }
  }

  async function previewImport() {
    setBusy('preview'); setError(null); setSuccess(null);
    try {
      const { data } = await api.post<CsvTeamImportPreview>(`/event-tools/competitions/${competitionId}/team-import/preview`, { csv });
      setPreview(data);
    } catch (caught) { setError(message(caught, 'Couldn’t preview this import.')); }
    finally { setBusy(null); }
  }

  async function applyImport() {
    if (!preview) return;
    setBusy('apply'); setError(null); setSuccess(null);
    try {
      const { data } = await api.post<{ createdCount: number }>(`/event-tools/competitions/${competitionId}/team-import/apply`, {
        csv, fingerprint: preview.fingerprint, previewVersion: preview.previewVersion,
      });
      setSuccess(`${data.createdCount} ${data.createdCount === 1 ? 'team' : 'teams'} added.`);
      setPreview(null);
      onImported?.();
    } catch (caught) {
      setError(message(caught, 'Couldn’t add these teams. Preview the CSV again before retrying.'));
      setPreview(null);
    } finally { setBusy(null); }
  }

  const hasErrors = preview?.rows.some((row) => row.errors.length > 0) ?? false;

  return (
    <section aria-labelledby="import-title">
      {error && <div role="alert" className="mg-notice tools-msg">{error}</div>}
      {success && <div role="status" className="tools-success"><CheckCircle2 className="h-5 w-5" aria-hidden="true" />{success}</div>}
      <RefineSection title="Import teams from CSV" />
      <h2 id="import-title" className="sr-only">Import teams from CSV</h2>
      <RefineNote>Use the columns <strong>club</strong>, <strong>suffix</strong> and <strong>section</strong>. Nothing is added until you review the preview.</RefineNote>
      <RefineList as="div">
        <button type="button" className="rf-row" onClick={() => fileRef.current?.click()}>
          <Upload className="h-5 w-5 rf-chev" aria-hidden="true" /><span className="rf-grow rf-t1">Choose CSV file</span><Chevron />
        </button>
      </RefineList>
      <input ref={fileRef} className="sr-only" type="file" accept=".csv,text/csv" onChange={loadFile} tabIndex={-1} aria-label="CSV file" />
      <div className="tools-form">
        <label className="rf-fld">CSV text<textarea className="tools-csv" value={csv} onChange={(event) => changeCsv(event.target.value)} spellCheck={false} /></label>
        <button type="button" className="rf-btn rf-btn-primary rf-wide" disabled={busy !== null || !csv.trim()} onClick={previewImport}>{busy === 'preview' ? 'Checking rows…' : 'Preview teams'}</button>
      </div>
      {preview && <>
        <RefineSection title="Preview" meta={hasErrors ? 'Fix the marked rows, then preview again.' : 'All rows are ready to add.'} />
        <RefineList as="ul" label={`${preview.validRows} of ${preview.totalRows} rows ready`}>
          {preview.rows.map((row) => <li key={row.rowNumber} className="rf-row">
            <span className="rf-grow">
              <span className="rf-t1"><span>{row.club}</span> <span>{row.suffix}</span></span>
              <span className="rf-t2">Row {row.rowNumber} · {row.section}</span>
              {row.errors.length > 0 && <span className="rf-t2 tools-error">{row.errors.join(' ')}</span>}
            </span>
            {row.errors.length > 0 ? <RefineStatus tone="bad">Fix</RefineStatus> : <RefineStatus tone="ok">Ready</RefineStatus>}
          </li>)}
        </RefineList>
        <RefineFoot label="Add teams">
          <button type="button" className="rf-btn rf-btn-primary rf-wide" disabled={hasErrors || busy !== null} onClick={applyImport}>{busy === 'apply' ? 'Adding teams…' : `Add ${preview.validRows} ${preview.validRows === 1 ? 'team' : 'teams'}`}</button>
        </RefineFoot>
      </>}
    </section>
  );
}

export function DuplicateEventPanel({ competition }: { competition: CompetitionForTools }) {
  const [cloneName, setCloneName] = useState(`${competition.name} copy`);
  const [cloneStart, setCloneStart] = useState(() => localInput(competition.startDate));
  const [cloneEnd, setCloneEnd] = useState(() => localInput(competition.endDate));
  const [cloneResult, setCloneResult] = useState<CloneCompetitionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function cloneCompetition(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null); setSuccess(null); setCloneResult(null);
    try {
      const startIso = cloneStart ? new Date(cloneStart).toISOString() : new Date().toISOString();
      const { data } = await api.post<CloneCompetitionResult>(`/event-tools/competitions/${competition.id}/clone`, {
        name: cloneName, startDate: startIso, endDate: cloneEnd ? new Date(cloneEnd).toISOString() : null,
      });
      setCloneResult(data); setSuccess(`${data.name} is ready to edit.`);
    } catch (caught) { setError(message(caught, 'Couldn’t duplicate this competition.')); }
    finally { setBusy(false); }
  }

  return (
    <section aria-labelledby="duplicate-title">
      {error && <div role="alert" className="mg-notice tools-msg">{error}</div>}
      {success && <div role="status" className="tools-success"><CheckCircle2 className="h-5 w-5" aria-hidden="true" />{success}</div>}
      <RefineSection title="Duplicate event setup" />
      <h2 id="duplicate-title" className="sr-only">Duplicate event setup</h2>
      <RefineNote>Sections, teams, sessions, heats and races are copied. Results, declarations, payments and team claim details stay with the original event.</RefineNote>
      <form className="tools-form" onSubmit={cloneCompetition}><fieldset disabled={busy} className="tools-fields"><legend className="sr-only">New event details</legend>
        <label className="rf-fld">New competition name<input value={cloneName} onChange={(event) => setCloneName(event.target.value)} maxLength={200} required /></label>
        <label className="rf-fld">Starts<input type="datetime-local" value={cloneStart} onChange={(event) => setCloneStart(event.target.value)} required /></label>
        <label className="rf-fld">Ends<input type="datetime-local" value={cloneEnd} onChange={(event) => setCloneEnd(event.target.value)} /></label>
        <button className="rf-btn rf-btn-primary rf-wide">{busy ? 'Duplicating…' : 'Duplicate setup'}</button>
      </fieldset></form>
      {cloneResult && <>
        <RefineSection title="New event" />
        <RefineList as="div">
          <Link className="rf-row" to={`/admin/competitions/${cloneResult.competitionId}`}>
            <span className="rf-grow"><span className="rf-t1">{cloneResult.name}</span><span className="rf-t2">{cloneResult.sections} sections, {cloneResult.teams} teams and {cloneResult.heats} heats copied.</span></span>
            <span className="rf-st rf-ok">Edit the new event</span><Chevron />
          </Link>
        </RefineList>
      </>}
    </section>
  );
}

const PRINT_SHEETS = [
  { to: 'entries', title: 'Entry list', detail: 'Every team with its riders and ponies, to check before the day' },
  { to: 'draw', title: 'Draw and lanes', detail: 'Sessions, heats, lanes and race order' },
  { to: 'score-sheets', title: 'Score sheets', detail: 'Blank placing, elimination and points columns' },
  { to: 'results', title: 'Results', detail: 'Current section standings, marked provisional when unfinished' },
  { to: 'tack-check', title: 'Tack check forms', detail: 'One form per age group, with each team’s riders, ponies and a column per sector' },
  { to: 'poster', title: 'Venue poster', detail: 'Name, date, venue and a QR code to this event’s page' },
];

export function PrintSheetsPanel({ competitionId }: { competitionId: string }) {
  return (
    <section aria-labelledby="print-title">
      <RefineSection title="Print event sheets" />
      <h2 id="print-title" className="sr-only">Print event sheets</h2>
      <nav aria-label="Printable event sheets"><RefineList as="div">
        {PRINT_SHEETS.map((sheet) => <Link key={sheet.to} className="rf-row" to={`/event-tools/${competitionId}/print/${sheet.to}`}>
          <span className="rf-grow"><span className="rf-t1">{sheet.title}</span><span className="rf-t2">{sheet.detail}</span></span><Chevron />
        </Link>)}
      </RefineList></nav>
    </section>
  );
}
