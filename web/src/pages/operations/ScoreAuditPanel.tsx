import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { RefreshCw, Save } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useCompetition } from '../competition/context';
import { RefineDisclosure, RefineList, RefineNote, RefinePage, RefineSection } from '../refine/Refine';
import type { RaceScore, RaceScoreEventKind, RaceScoreHistory, ScorePlace } from './types';
import { apiMessage } from './types';
import './operations.css';

export function ScoreAuditPanel(props: { raceId: number; onChanged?: () => void }) {
  const { user } = useAuth();
  return <ScoreAuditRecord key={`${props.raceId}:${user?.id ?? ''}`} {...props} />;
}

function ScoreAuditRecord({ raceId, onChanged }: { raceId: number; onChanged?: () => void }) {
  const { canManage } = useAuth();
  const { competition } = useCompetition();
  const [score, setScore] = useState<RaceScore | null>(null);
  const [history, setHistory] = useState<RaceScoreHistory[]>([]);
  const [draft, setDraft] = useState<ScorePlace[]>([]);
  const [correctionReason, setCorrectionReason] = useState('');
  const [actionReason, setActionReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [scoreResponse, historyResponse] = await Promise.all([
        api.get<RaceScore>(`/races/${raceId}/score`),
        api.get<RaceScoreHistory[]>(`/races/${raceId}/score/history`),
      ]);
      setScore(scoreResponse.data);
      setDraft(scoreResponse.data.results.map((result) => ({ ...result })));
      setHistory(historyResponse.data);
    } catch (loadError) {
      setError(apiMessage(loadError, 'Couldn’t load the score record. Try again.'));
    } finally {
      setLoading(false);
    }
  }, [raceId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function updateScore(event: FormEvent) {
    event.preventDefault();
    if (!score || busy || loading) return;
    if (!correctionReason.trim()) {
      setError('Add a reason for this correction.');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.put(`/races/${raceId}/score`, {
        places: draft.map((result) => ({ teamId: result.teamId, place: result.place, eliminated: result.eliminated })),
        expectedRevision: score.revision,
        requestId: requestId('correction'),
        reason: correctionReason.trim(),
      });
      setCorrectionReason('');
      setMessage('Correction saved.');
      await load();
      onChanged?.();
    } catch (saveError) {
      setError(apiMessage(saveError, 'Couldn’t save the correction. Refresh the score and try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function changeSignOff(signOff: boolean) {
    if (!score || busy || loading) return;
    if (!signOff && !actionReason.trim()) {
      setError('Add a reason for reopening these results.');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.post(`/races/${raceId}/score/${signOff ? 'sign-off' : 'reopen'}`, {
        expectedRevision: score.revision,
        requestId: requestId(signOff ? 'sign-off' : 'reopen'),
        reason: actionReason.trim() || null,
      });
      setActionReason('');
      setMessage(signOff ? 'Results signed off.' : 'Results reopened for correction.');
      await load();
      onChanged?.();
    } catch (actionError) {
      setError(apiMessage(actionError, 'Couldn’t update the sign-off. Refresh the score and try again.'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <RefinePage><p role="status" className="rf-note">Loading score history…</p></RefinePage>;

  const heading = `score-audit-${raceId}`;
  return (
    <RefinePage>
      <section aria-labelledby={heading}>
        <RefineSection title="Score record" meta={`Revision ${score?.revision ?? 0}`} />
        <h2 id={heading} className="sr-only">Score record</h2>
        {error && <p role="alert" className="mg-notice ops-alert">{error}</p>}
        {message && <p role="status" className="rf-note ops-ok">{message}</p>}

        {score && <>
          <RefineList as="div">
            <div className="rf-row">
              <span className="rf-grow">
                <span className="rf-t1">{score.isSignedOff ? 'Signed off' : 'Open for scoring'}</span>
                {score.signedOffAt && <span className="rf-t2">{new Date(score.signedOffAt).toLocaleString('en-GB')}{score.signedOffByUserId ? <> · Actor <code className="break-all">{score.signedOffByUserId}</code></> : null}</span>}
              </span>
              <button type="button" className="rf-btn rf-btn-text" aria-label="Refresh score record" onClick={() => void load()} disabled={loading || busy}><RefreshCw aria-hidden="true" className={`h-4 w-4 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`} />Refresh</button>
            </div>
          </RefineList>

          {canManage(competition) && <>
            <RefineSection title={score.isSignedOff ? 'Reopen' : 'Sign off'} />
            <div className="ops-form ops-panel">
              <label className="rf-fld" htmlFor={`score-action-reason-${raceId}`}>{score.isSignedOff ? 'Reason for reopening' : 'Sign-off note (optional)'}
                <textarea id={`score-action-reason-${raceId}`} className="ops-note-input" value={actionReason} onChange={(event) => setActionReason(event.target.value)} maxLength={1000} />
              </label>
              <button type="button" className="rf-btn rf-btn-primary" disabled={busy || loading} onClick={() => void changeSignOff(!score.isSignedOff)}>{score.isSignedOff ? 'Reopen results' : 'Sign off results'}</button>
            </div>
          </>}

          {canManage(competition) && !score.isSignedOff && draft.length > 0 && <>
            <RefineSection title="Corrections" />
            <RefineList as="div">
              <RefineDisclosure title="Correct placings" sub="Every correction needs a reason">
                <form className="ops-form ops-panel" onSubmit={updateScore}>
                  <p className="rf-note">Use the recorded team IDs below.</p>
                  <ul className="ops-places">{draft.map((result, index) => (
                    <li key={result.teamId} className="ops-place">
                      <span className="rf-grow"><span className="rf-t1">Team {result.teamId}</span><span className="rf-t2">Points now {result.points}</span></span>
                      <label className="rf-fld ops-place-field">Place<input aria-label={`Place for team ${result.teamId}`} type="number" min="1" disabled={result.eliminated} value={result.place || 1} onChange={(event) => setDraft((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, place: Number(event.target.value) } : item))} /></label>
                      <label className="ops-elim"><input aria-label={`Eliminated team ${result.teamId}`} type="checkbox" checked={result.eliminated} onChange={(event) => setDraft((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, eliminated: event.target.checked } : item))} />Eliminated</label>
                    </li>
                  ))}</ul>
                  <label className="rf-fld">Correction reason<textarea className="ops-note-input" required maxLength={1000} value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} /></label>
                  <button type="submit" className="rf-btn rf-btn-primary" disabled={busy || loading}><Save aria-hidden="true" className="h-4 w-4" />{busy ? 'Saving…' : 'Save correction'}</button>
                </form>
              </RefineDisclosure>
            </RefineList>
          </>}

          <RefineSection title="History" />
          {history.length === 0
            ? <RefineNote>No score changes have been recorded yet.</RefineNote>
            : <RefineList as="ol" label="Score history">{history.map((entry) => (
              <li key={entry.revision} className="rf-row ops-history">
                <span className="rf-grow">
                  <span className="rf-t1">{eventLabel(entry.kind)}</span>
                  <span className="rf-t2">Revision {entry.revision} · {new Date(entry.createdAt).toLocaleString('en-GB')}</span>
                  <span className="ops-reason">{entry.reason}</span>
                  {entry.actorUserId && <span className="rf-t2">Actor <code className="break-all">{entry.actorUserId}</code></span>}
                  <span className="rf-t2">{scoreSummary(entry.before)} → {scoreSummary(entry.after)}</span>
                </span>
              </li>
            ))}</RefineList>}
        </>}
      </section>
    </RefinePage>
  );
}

function requestId(action: string): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${action}-${id}`;
}

function eventLabel(kind: RaceScoreEventKind): string {
  return ({ 1: 'Results recorded', 2: 'Results corrected', 3: 'Signed off', 4: 'Reopened' } as const)[kind];
}

function scoreSummary(results: ScorePlace[]): string {
  if (results.length === 0) return 'No results';
  return results.map((result) => result.eliminated ? `Team ${result.teamId}: E` : `Team ${result.teamId}: ${result.place}`).join(', ');
}
