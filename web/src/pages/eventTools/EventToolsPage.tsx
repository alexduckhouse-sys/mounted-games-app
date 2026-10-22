import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { CheckCircle2, Upload } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { Chevron, RefineFoot, RefineHeader, RefineList, RefineNote, RefinePage, RefineSection, RefineStatus } from '../refine/Refine';
import type { CloneCompetitionResult, CsvTeamImportPreview } from './eventToolsTypes';
import './eventTools.css';

interface CompetitionForTools {
  id: number;
  name: string;
  startDate: string;
  endDate: string | null;
  createdByUserId: string | null;
}

type ToolTab = 'import' | 'duplicate' | 'print';

function message(error: unknown, fallback: string) {
  const candidate = error as { response?: { data?: { detail?: string; title?: string } } };
  return candidate.response?.data?.detail ?? candidate.response?.data?.title ?? fallback;
}

function localInput(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default function EventToolsPage() {
  const { competitionId = '' } = useParams();
  const { user, editorMode } = useAuth();
  return <EventToolsPageContent key={`${competitionId}:${user?.id ?? 'public'}:${editorMode}`} competitionId={competitionId} />;
}

function EventToolsPageContent({ competitionId }: { competitionId: string }) {
  const { user, hasRole, canEdit } = useAuth();
  const mayManage = !hasRole('Admin') || canEdit();
  const fileRef = useRef<HTMLInputElement>(null);
  const [competition, setCompetition] = useState<CompetitionForTools | null>(null);
  const [tab, setTab] = useState<ToolTab>('import');
  const [csv, setCsv] = useState('club,suffix,section\n');
  const [preview, setPreview] = useState<CsvTeamImportPreview | null>(null);
  const [cloneName, setCloneName] = useState('');
  const [cloneStart, setCloneStart] = useState('');
  const [cloneEnd, setCloneEnd] = useState('');
  const [cloneResult, setCloneResult] = useState<CloneCompetitionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'preview' | 'apply' | 'clone' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.get<CompetitionForTools>(`/competitions/${competitionId}`)
      .then(({ data }) => {
        if (cancelled) return;
        setCompetition(data);
        setCloneName(`${data.name} copy`);
        setCloneStart(localInput(data.startDate));
        setCloneEnd(localInput(data.endDate));
      })
      .catch((caught) => { if (!cancelled) setError(message(caught, 'Couldn’t load this competition.')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [competitionId, user?.id, loadAttempt]);

  function selectTab(next: ToolTab) {
    setTab(next); setError(null); setSuccess(null);
  }

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
      const { data } = await api.post<{ createdCount: number }>(`/event-tools/competitions/${competitionId}/team-import/apply`, { csv, fingerprint: preview.fingerprint, previewVersion: preview.previewVersion });
      setSuccess(`${data.createdCount} ${data.createdCount === 1 ? 'team' : 'teams'} added.`); setPreview(null);
    } catch (caught) {
      setError(message(caught, 'Couldn’t add these teams. Preview the CSV again before retrying.')); setPreview(null);
    } finally { setBusy(null); }
  }

  async function cloneCompetition(event: FormEvent) {
    event.preventDefault();
    setBusy('clone'); setError(null); setSuccess(null); setCloneResult(null);
    try {
      const { data } = await api.post<CloneCompetitionResult>(`/event-tools/competitions/${competitionId}/clone`, {
        name: cloneName, startDate: new Date(cloneStart).toISOString(), endDate: cloneEnd ? new Date(cloneEnd).toISOString() : null,
      });
      setCloneResult(data); setSuccess(`${data.name} is ready to edit.`);
    } catch (caught) { setError(message(caught, 'Couldn’t duplicate this competition.')); }
    finally { setBusy(null); }
  }

  if (loading) return <RefinePage><p role="status" className="rf-note tools-pad">Loading organiser tools…</p></RefinePage>;
  if (!competition) return <RefinePage><div role="alert" className="tools-pad"><p className="mg-notice">{error ?? 'Competition not found.'} <button type="button" className="rf-btn rf-btn-text" onClick={() => { setLoading(true); setError(null); setLoadAttempt((value) => value + 1); }}>Try again</button></p></div></RefinePage>;
  // The event tools API is for the owner and admins only (not the competition's helpers).
  const ownsOrAdmin = hasRole('Admin') || (hasRole('Trainer') && competition.createdByUserId === user?.id);
  if (!mayManage || !ownsOrAdmin) return <RefinePage><div role="alert" className="tools-pad"><p className="mg-notice">These tools are available to this competition’s organiser.</p></div></RefinePage>;

  const hasErrors = preview?.rows.some((row) => row.errors.length > 0) ?? false;
  const tabs: { id: ToolTab; label: string }[] = [
    { id: 'import', label: 'Import teams' },
    { id: 'duplicate', label: 'Duplicate event' },
    { id: 'print', label: 'Print sheets' },
  ];
  const printSheets = [
    { to: 'draw', title: 'Draw and lanes', detail: 'Sessions, heats, lanes and race order' },
    { to: 'score-sheets', title: 'Score sheets', detail: 'Blank placing, elimination and points columns' },
    { to: 'results', title: 'Results', detail: 'Current section standings, marked provisional when unfinished' },
    { to: 'poster', title: 'Venue poster', detail: 'Name, date, venue and a QR code to this event’s page' },
  ];

  return <RefinePage className="tools-page">
    <RefineHeader
      back={`/competitions/${competitionId}`}
      backLabel="Back to event"
      context={competition.name}
      title="Organiser tools"
      subtitle="Choose the job you need. Each tool works separately."
      tabs={tabs.map((item) => ({ label: item.label, active: tab === item.id, onSelect: () => selectTab(item.id) }))}
      tabsLabel="Organiser tools"
      tabsKind="tablist"
    />
    {error && <div role="alert" className="mg-notice tools-msg">{error}</div>}
    {success && <div role="status" className="tools-success"><CheckCircle2 className="h-5 w-5" aria-hidden="true" />{success}</div>}

    {tab === 'import' && <section aria-labelledby="import-title">
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
        <RefineNote>{preview.validRows} of {preview.totalRows} rows ready.</RefineNote>
        <RefineFoot label="Add teams">
          <button type="button" className="rf-btn rf-btn-primary rf-wide" disabled={hasErrors || busy !== null} onClick={applyImport}>{busy === 'apply' ? 'Adding teams…' : `Add ${preview.validRows} ${preview.validRows === 1 ? 'team' : 'teams'}`}</button>
        </RefineFoot>
      </>}
    </section>}

    {tab === 'duplicate' && <section aria-labelledby="duplicate-title">
      <RefineSection title="Duplicate event setup" />
      <h2 id="duplicate-title" className="sr-only">Duplicate event setup</h2>
      <RefineNote>Sections, teams, sessions, heats and races are copied. Results, declarations, payments and team claim details stay with the original event.</RefineNote>
      <form className="tools-form" onSubmit={cloneCompetition}><fieldset disabled={busy !== null} className="tools-fields"><legend className="sr-only">New event details</legend>
        <label className="rf-fld">New competition name<input value={cloneName} onChange={(event) => setCloneName(event.target.value)} maxLength={200} required /></label>
        <label className="rf-fld">Starts<input type="datetime-local" value={cloneStart} onChange={(event) => setCloneStart(event.target.value)} required /></label>
        <label className="rf-fld">Ends<input type="datetime-local" value={cloneEnd} onChange={(event) => setCloneEnd(event.target.value)} /></label>
        <button className="rf-btn rf-btn-primary rf-wide">{busy === 'clone' ? 'Duplicating…' : 'Duplicate setup'}</button>
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
    </section>}

    {tab === 'print' && <section aria-labelledby="print-title">
      <RefineSection title="Print event sheets" />
      <h2 id="print-title" className="sr-only">Print event sheets</h2>
      <RefineNote>Each link opens a clean A4 view ready for your browser’s print command.</RefineNote>
      <nav aria-label="Printable event sheets"><RefineList as="div">
        {printSheets.map((sheet) => <Link key={sheet.to} className="rf-row" to={`/event-tools/${competitionId}/print/${sheet.to}`}>
          <span className="rf-grow"><span className="rf-t1">{sheet.title}</span><span className="rf-t2">{sheet.detail}</span></span><Chevron />
        </Link>)}
      </RefineList></nav>
    </section>}
  </RefinePage>;
}
