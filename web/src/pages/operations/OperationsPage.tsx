import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, RefreshCw, Shuffle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useCompetition } from '../competition/context';
import type { CompetitionReadiness, DrawPreview } from './types';
import { apiMessage } from './types';
import './operations.css';

export function OperationsPage() {
  const { competition } = useCompetition();
  const { user, canOrganise, canEdit, hasRole } = useAuth();
  if (!user || !canOrganise(competition)) {
    return <div className="mx-auto w-full max-w-4xl py-4 mg-font"><p role="alert" className="mg-card p-4">You don’t have access to competition operations.</p></div>;
  }
  const canWrite = hasRole('Admin') ? canEdit() : true;
  return <OperationsPageContent key={`${competition.id}:${user.id}`} canWrite={canWrite} />;
}

function OperationsPageContent({ canWrite }: { canWrite: boolean }) {
  const { competition, reload: reloadCompetition } = useCompetition();
  const [view, setView] = useState<'checks' | 'equipment' | 'draw'>('checks');
  const [readiness, setReadiness] = useState<CompetitionReadiness | null>(null);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [loadingReadiness, setLoadingReadiness] = useState(true);
  const [savingChecklist, setSavingChecklist] = useState(false);
  const [checkedEquipment, setCheckedEquipment] = useState<Set<string>>(new Set());
  const [checklistSaved, setChecklistSaved] = useState(false);
  const [sectionId, setSectionId] = useState<number | null>(competition.sections[0]?.id ?? null);
  const [seed, setSeed] = useState('1');
  const [preview, setPreview] = useState<DrawPreview | null>(null);
  const [drawError, setDrawError] = useState<string | null>(null);
  const [drawMessage, setDrawMessage] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);

  const loadReadiness = useCallback(async () => {
    setLoadingReadiness(true);
    setReadinessError(null);
    setChecklistSaved(false);
    try {
      const { data } = await api.get<CompetitionReadiness>(
        `/competitions/${competition.id}/operations/readiness`,
      );
      setReadiness(data);
      setCheckedEquipment(new Set(data.equipmentChecklist.filter((item) => item.acknowledged).map((item) => item.key)));
    } catch (error) {
      setReadinessError(apiMessage(error, 'Couldn’t refresh the readiness checks. Try again.'));
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
    setReadinessError(null);
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
      setReadinessError(apiMessage(error, status === 409
        ? 'The checklist changed on another device. Refresh before saving again.'
        : 'Couldn’t save the equipment checklist. Try again.'));
    } finally {
      setSavingChecklist(false);
    }
  }

  async function previewDraw() {
    const parsedSeed = Number(seed);
    if (sectionId == null || !Number.isSafeInteger(parsedSeed)) {
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
    } catch (error) {
      setDrawError(apiMessage(error, 'Couldn’t preview this draw. Check the section and try again.'));
    } finally {
      setPreviewing(false);
    }
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

  return (
    <div className="ops-page">
      <header className="ops-header">
        <div><p className="mg-kicker">{competition.name}</p><h1 className="mg-h1 mg-h1-sm">Event checks</h1></div>
        <button type="button" className="mg-icon-btn" aria-label="Refresh checks" onClick={() => void loadReadiness()} disabled={loadingReadiness}><RefreshCw aria-hidden="true" className={`h-4 w-4 ${loadingReadiness ? 'animate-spin motion-reduce:animate-none' : ''}`} /></button>
      </header>
      <nav className="ops-tabs" aria-label="Event tools">
        {(['checks', 'equipment', 'draw'] as const).map((item) => <button key={item} type="button" aria-pressed={view === item} onClick={() => setView(item)}>{item === 'checks' ? 'Checks' : item === 'equipment' ? 'Equipment' : 'Draw'}</button>)}
      </nav>
      {readinessError && <p role="alert" className="mg-notice">{readinessError} <button className="mg-text-link" onClick={() => void loadReadiness()}>Try again</button></p>}
      {!canWrite && <p className="mg-meta">Switch on Edit mode to save checklist changes or apply a draw.</p>}
      {loadingReadiness && !readiness && <p role="status" className="mg-meta">Checking competition details…</p>}
      {view === 'checks' && readiness && <section className="ops-checks" aria-label="Readiness checks">
        <div className={`ops-status ${readiness.isReady ? 'ops-status-ready' : ''}`}>
          {readiness.isReady ? <CheckCircle2 aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
          <div><h2 className="mg-h2">{readiness.isReady ? 'Ready to run' : 'Before the first heat'}</h2><p className="mg-meta">{readiness.isReady ? 'All checks are clear.' : 'Resolve the open jobs and check your arena equipment.'}</p></div>
        </div>
        <ReadinessIssues readiness={readiness} competitionId={competition.id} />
        <button type="button" className="ops-equipment-link" onClick={() => setView('equipment')}><ClipboardCheck aria-hidden="true" /><span><strong>Check the arena equipment</strong><span className="mg-meta">{readiness.equipmentChecklist.filter((item) => item.acknowledged).length} of {readiness.equipmentChecklist.length} items ready</span></span><span aria-hidden="true">›</span></button>
      </section>}
      {view === 'equipment' && readiness && (
            <section className="ops-equipment" aria-labelledby="equipment-heading">
              <div className="flex items-center gap-3 border-b border-[rgb(var(--mg-rule))] p-4">
                <ClipboardCheck aria-hidden="true" className="h-5 w-5 text-[rgb(var(--mg-heading))]" />
                <div className="flex-1">
                  <h2 id="equipment-heading" className="mg-h2">Equipment checklist</h2>
                  <p className="mg-meta mt-1">{checkedEquipment.size} of {readiness.equipmentChecklist.length} items checked</p>
                </div>
              </div>
              {readiness.equipmentChecklist.length === 0
                ? <p className="p-4 text-[rgb(var(--mg-muted))]">No equipment items were found for the current race list.</p>
                : <div className="mg-list">
                    {readiness.equipmentChecklist.map((item) => (
                      <label key={item.key} className="mg-row cursor-pointer">
                        <input
                          type="checkbox"
                          className="h-5 w-5 shrink-0 accent-[rgb(var(--mg-button))]"
                          checked={checkedEquipment.has(item.key)}
                          disabled={!canWrite}
                          onChange={(event) => setCheckedEquipment((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(item.key); else next.delete(item.key);
                            setChecklistSaved(false);
                            return next;
                          })}
                        />
                        <span className="min-w-0 flex-1">
                          <strong className="block text-[rgb(var(--mg-heading))]">{item.count} × {item.kind}</strong>
                          <span className="mg-meta">{item.bucket}</span>
                        </span>
                      </label>
                    ))}
                  </div>}
              <div className="ops-save-bar">
                <button type="button" className="mg-btn mg-btn-primary" onClick={() => void saveChecklist()} disabled={savingChecklist || !canWrite}>
                  {savingChecklist ? 'Saving…' : 'Save checklist'}
                </button>
                {checklistSaved && <span role="status" className="mg-meta">Checklist saved.</span>}
              </div>
            </section>
      )}
      {view === 'draw' && (
      <section className="flex flex-col gap-3" aria-labelledby="draw-heading">
        <div>
          <h2 id="draw-heading" className="mg-h2">Section draw</h2>
          <p className="mg-meta mt-1">Preview the lanes first. Applying a draw changes assignments across the section’s unscored sessions.</p>
        </div>
        <div className="ops-draw-controls">
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-[rgb(var(--mg-heading))]">
            Section
            <span className="mg-field">
              <select value={sectionId ?? ''} onChange={(event) => { setSectionId(Number(event.target.value)); setPreview(null); setDrawMessage(null); }}>
                {competition.sections.map((section) => <option key={section.id} value={section.id}>{section.displayName}</option>)}
              </select>
            </span>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-[rgb(var(--mg-heading))]">
            Draw number
            <span className="mg-field"><input type="number" step="1" value={seed} onChange={(event) => { setSeed(event.target.value); setPreview(null); setDrawMessage(null); }} /></span>
          </label>
          <p className="mg-meta ops-draw-help">The same number gives the same draw. Change it to try a different arrangement.</p>
          <button type="button" className="mg-btn mg-btn-primary" onClick={() => void previewDraw()} disabled={previewing || sectionId == null}>
            <Shuffle aria-hidden="true" className="h-4 w-4" />
            {previewing ? 'Preparing…' : 'Preview draw'}
          </button>
        </div>
        {competition.sections.length === 0 && <p className="mg-card p-4 text-[rgb(var(--mg-muted))]">Add a section before preparing a draw.</p>}
        {drawError && <p role="alert" className="mg-notice">{drawError}</p>}
        {drawMessage && <p role="status" className="mg-notice">{drawMessage}</p>}
        {preview && <DrawPreviewPanel preview={preview} applying={applying} canApply={canWrite} onApply={() => void applyDraw()} />}
      </section>
      )}
    </div>
  );
}

function ReadinessIssues({ readiness, competitionId }: { readiness: CompetitionReadiness; competitionId: number }) {
  const groups = [
    { title: 'Missing declarations', items: [
    ...readiness.missingDeclarations.map((item) => ({ key: `d-${item.teamId}`, title: `${item.teamName} needs a declaration`, detail: item.sectionName, to: `/competitions/${competitionId}/declarations` })),
    ] }, { title: 'Unpaid entries', items: [
    ...readiness.unpaidSignups.map((item) => ({ key: `u-${item.signupId}`, title: `Payment pending in ${item.sectionName}`, detail: `${(item.amountMinor / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP' })} due`, to: `/competitions/${competitionId}/details` })),
    ] }, { title: 'Incomplete teams', items: [
    ...readiness.incompleteTeams.map((item) => ({ key: `i-${item.teamId}`, title: `${item.teamName} has ${item.declaredRiders} of ${item.minimumRiders} riders`, detail: item.sectionName, to: `/competitions/${competitionId}/teams` })),
    ] }, { title: 'Arena overlaps', items: [
    ...readiness.sessionOverlaps.map((item) => ({ key: `o-${item.firstSessionId}-${item.secondSessionId}`, title: `${item.firstSessionName} overlaps ${item.secondSessionName}`, detail: item.arena, to: `/competitions/${competitionId}` })),
    ] }, { title: 'Equipment details', items: [
    ...readiness.equipmentIssues.map((item) => ({ key: `e-${item.raceName}`, title: `${item.raceName} needs equipment details`, detail: item.message, to: `/competitions/${competitionId}` })),
    ] },
  ].filter((group) => group.items.length > 0);
  const issueCount = groups.reduce((count, group) => count + group.items.length, 0);
  if (!issueCount) return null;
  return (
    <section aria-labelledby="issues-heading">
      <div className="mg-section-head"><h2 id="issues-heading">Open jobs</h2><span>{issueCount}</span></div>
      <div className="ops-jobs">
        {groups.map((group) => <details key={group.title} open={group.items.length <= 3}>
          <summary><span>{group.title}</span><strong>{group.items.length}</strong></summary>
          <div className="mg-list">{group.items.map((issue) => (
          <Link key={issue.key} to={issue.to} className="mg-row">
            <span className="min-w-0 flex-1"><strong className="block text-[rgb(var(--mg-heading))]">{issue.title}</strong><span className="mg-meta">{issue.detail}</span></span>
            <span aria-hidden="true" className="text-[rgb(var(--mg-heading))]">›</span>
          </Link>
        ))}</div></details>)}
      </div>
    </section>
  );
}

function DrawPreviewPanel({ preview, applying, canApply, onApply }: { preview: DrawPreview; applying: boolean; canApply: boolean; onApply: () => void }) {
  const fairness = preview.fairness;
  return (
    <div className="flex flex-col gap-3">
      <div className="ops-fairness">
        <Diagnostic label="Heat size spread" value={fairness.heatSizeSpread} />
        <Diagnostic label="Most opponent meetings" value={fairness.maximumOpponentMeetings} />
        <Diagnostic label="Repeated pairings" value={fairness.repeatedOpponentPairs} />
        <Diagnostic label="Lane-use spread" value={fairness.maximumLaneUseSpread} />
      </div>
      {!fairness.everyTeamAppearsOncePerSession && <p role="alert" className="mg-notice">This preview doesn’t cover every team once per session. Don’t apply it.</p>}
      {fairness.warnings.length > 0 && <div className="mg-card p-4"><h3 className="font-semibold text-[rgb(var(--mg-heading))]">Fairness notes</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{fairness.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
      {preview.sessions.map((session) => (
        <section key={session.sessionId} className="ops-draw-session" aria-labelledby={`draw-session-${session.sessionId}`}>
          <h3 id={`draw-session-${session.sessionId}`} className="mg-h2 border-b border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-subtle))] p-4">{session.name}</h3>
          <div className="grid gap-3 p-3 md:grid-cols-2">
            {session.heats.map((heat) => (
              <div key={heat.heatId} className="overflow-hidden border-b border-[rgb(var(--mg-rule))]">
                <h4 className="bg-[rgb(var(--mg-subtle))] px-3 py-2 font-semibold text-[rgb(var(--mg-heading))]">{heat.label || `Heat ${heat.orderIndex}`}</h4>
                <table className="w-full text-left text-sm">
                  <thead className="sr-only"><tr><th>Lane</th><th>Team</th></tr></thead>
                  <tbody>{heat.teams.map((team) => <tr key={team.teamId} className="border-t border-[rgb(var(--mg-rule-soft))]"><td className="w-16 px-3 py-2 font-semibold">{team.laneIndex}</td><td className="px-3 py-2">{team.teamName}</td></tr>)}</tbody>
                </table>
              </div>
            ))}
          </div>
        </section>
      ))}
      <div className="ops-save-bar">
        <p className="mg-meta min-w-0 flex-1">Applying this preview replaces lane assignments only. Heat and race details stay in place.</p>
        <button type="button" className="mg-btn mg-btn-primary" onClick={onApply} disabled={applying || !canApply || !fairness.everyTeamAppearsOncePerSession}>
          {applying ? 'Applying…' : 'Apply draw'}
        </button>
      </div>
    </div>
  );
}

function Diagnostic({ label, value }: { label: string; value: number }) {
  return <div className="ops-diagnostic"><strong className="block text-xl text-[rgb(var(--mg-heading))]">{value}</strong><span className="mg-meta">{label}</span></div>;
}
