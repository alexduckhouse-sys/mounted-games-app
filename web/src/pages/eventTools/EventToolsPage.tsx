import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { CheckCircle2, ChevronLeft, Copy, FileSpreadsheet, Printer, Upload } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
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
  const { user, canOrganise, hasRole, canEdit } = useAuth();
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

  if (loading) return <p role="status" className="skin tools-shell py-5">Loading organiser tools…</p>;
  if (!competition) return <div role="alert" className="skin tools-shell py-5"><p className="mg-notice">{error ?? 'Competition not found.'} <button type="button" className="mg-text-link min-h-11" onClick={() => { setLoading(true); setError(null); setLoadAttempt((value) => value + 1); }}>Try again</button></p></div>;
  if (!mayManage || !canOrganise(competition)) return <div role="alert" className="skin tools-shell py-5"><p className="mg-notice">These tools are available to this competition’s organiser.</p></div>;

  const hasErrors = preview?.rows.some((row) => row.errors.length > 0) ?? false;
  const tabs: { id: ToolTab; label: string; icon: typeof FileSpreadsheet }[] = [
    { id: 'import', label: 'Import teams', icon: FileSpreadsheet },
    { id: 'duplicate', label: 'Duplicate event', icon: Copy },
    { id: 'print', label: 'Print sheets', icon: Printer },
  ];

  return <div className="skin tools-shell py-5">
    <Link className="mg-text-link mb-4 inline-flex min-h-11 items-center gap-1" to={`/competitions/${competitionId}`}><ChevronLeft className="h-4 w-4" />Back to event</Link>
    <header className="tools-heading"><p className="tools-kicker">{competition.name}</p><h1 className="mg-h1">Organiser tools</h1><p className="mg-meta mt-2">Choose the job you need. Each tool works separately.</p></header>
    <nav className="tools-tabs" aria-label="Organiser tools">{tabs.map((item) => <button type="button" key={item.id} className="tools-tab" aria-pressed={tab === item.id} onClick={() => selectTab(item.id)}><item.icon className="h-5 w-5" />{item.label}</button>)}</nav>
    {error && <div role="alert" className="mg-notice mt-5">{error}</div>}
    {success && <div role="status" className="tools-success mt-5"><CheckCircle2 className="h-5 w-5" />{success}</div>}

    {tab === 'import' && <section className="tools-panel" aria-labelledby="import-title">
      <div className="tools-panel-heading"><h2 id="import-title" className="mg-h1 mg-h1-sm">Import teams from CSV</h2><p className="mg-meta mt-1">Use the columns <strong>club</strong>, <strong>suffix</strong> and <strong>section</strong>. Nothing is added until you review the preview.</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" className="mg-btn mg-btn-secondary" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" />Choose CSV file</button><input ref={fileRef} className="sr-only" type="file" accept=".csv,text/csv" onChange={loadFile} /></div>
      <label className="mt-5 block font-semibold">CSV text<textarea className="input mt-1 min-h-48 font-mono text-sm" value={csv} onChange={(event) => changeCsv(event.target.value)} spellCheck={false} /></label>
      <button type="button" className="mg-btn mg-btn-primary mt-3" disabled={busy !== null || !csv.trim()} onClick={previewImport}>{busy === 'preview' ? 'Checking rows…' : 'Preview teams'}</button>
      {preview && <div className="tools-preview">
        <div className="tools-preview-summary"><strong>{preview.validRows} of {preview.totalRows}</strong><span>{hasErrors ? 'Fix the marked rows, then preview again.' : 'All rows are ready to add.'}</span></div>
        <div className="tools-table-wrap"><table className="tools-table"><thead><tr><th>Row</th><th>Club</th><th>Suffix</th><th>Section</th><th>Check</th></tr></thead><tbody>{preview.rows.map((row) => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.club}</td><td>{row.suffix}</td><td>{row.section}</td><td className={row.errors.length ? 'tools-error' : 'tools-ready'}>{row.errors.length ? row.errors.join(' ') : 'Ready'}</td></tr>)}</tbody></table></div>
        <button type="button" className="mg-btn mg-btn-primary mt-4" disabled={hasErrors || busy !== null} onClick={applyImport}>{busy === 'apply' ? 'Adding teams…' : `Add ${preview.validRows} ${preview.validRows === 1 ? 'team' : 'teams'}`}</button>
      </div>}
    </section>}

    {tab === 'duplicate' && <section className="tools-panel" aria-labelledby="duplicate-title">
      <div className="tools-panel-heading"><h2 id="duplicate-title" className="mg-h1 mg-h1-sm">Duplicate event setup</h2><p className="mg-meta mt-1">Sections, teams, sessions, heats and races are copied. Results, declarations, payments and team claim details stay with the original event.</p></div>
      <form className="tools-form" onSubmit={cloneCompetition}><fieldset disabled={busy !== null} className="space-y-4"><legend className="sr-only">New event details</legend>
        <label className="block font-semibold">New competition name<input className="input mt-1" value={cloneName} onChange={(event) => setCloneName(event.target.value)} maxLength={200} required /></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="block font-semibold">Starts<input className="input mt-1" type="datetime-local" value={cloneStart} onChange={(event) => setCloneStart(event.target.value)} required /></label><label className="block font-semibold">Ends<input className="input mt-1" type="datetime-local" value={cloneEnd} onChange={(event) => setCloneEnd(event.target.value)} /></label></div>
        <button className="mg-btn mg-btn-primary" disabled={busy !== null}>{busy === 'clone' ? 'Duplicating…' : 'Duplicate setup'}</button>
      </fieldset></form>
      {cloneResult && <div className="tools-result"><p><strong>{cloneResult.name}</strong></p><p>{cloneResult.sections} sections, {cloneResult.teams} teams and {cloneResult.heats} heats copied.</p><Link className="mg-btn mg-btn-secondary mt-3" to={`/admin/competitions/${cloneResult.competitionId}`}>Edit the new event</Link></div>}
    </section>}

    {tab === 'print' && <section className="tools-panel" aria-labelledby="print-title">
      <div className="tools-panel-heading"><h2 id="print-title" className="mg-h1 mg-h1-sm">Print event sheets</h2><p className="mg-meta mt-1">Each link opens a clean A4 view ready for your browser’s print command.</p></div>
      <nav className="tools-print-list" aria-label="Printable event sheets"><Link to={`/event-tools/${competitionId}/print/draw`}><span><strong>Draw and lanes</strong><small>Sessions, heats, lanes and race order</small></span><ChevronLeft className="h-5 w-5 rotate-180" /></Link><Link to={`/event-tools/${competitionId}/print/score-sheets`}><span><strong>Score sheets</strong><small>Blank placing, elimination and points columns</small></span><ChevronLeft className="h-5 w-5 rotate-180" /></Link><Link to={`/event-tools/${competitionId}/print/results`}><span><strong>Results</strong><small>Current section standings, marked provisional when unfinished</small></span><ChevronLeft className="h-5 w-5 rotate-180" /></Link></nav>
    </section>}
  </div>;
}
