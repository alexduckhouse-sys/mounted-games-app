import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, History, LockOpen, RefreshCw, Save } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import type { RaceScore, RaceScoreEventKind, RaceScoreHistory, ScorePlace } from './types';
import { apiMessage } from './types';

export function ScoreAuditPanel(props: { raceId: number; onChanged?: () => void }) {
  const { user } = useAuth();
  return <ScoreAuditRecord key={`${props.raceId}:${user?.id ?? ''}`} {...props} />;
}

function ScoreAuditRecord({ raceId, onChanged }: { raceId: number; onChanged?: () => void }) {
  const { canEdit } = useAuth();
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

  if (loading) return <p role="status" className="mg-card p-4 text-[rgb(var(--mg-muted))]">Loading score history…</p>;

  return (
    <section className="mg-card overflow-hidden mg-font" aria-labelledby={`score-audit-${raceId}`}>
      <div className="flex flex-wrap items-center gap-3 border-b border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-subtle))] p-4">
        <History aria-hidden="true" className="h-5 w-5 text-[rgb(var(--mg-heading))]" />
        <div className="min-w-0 flex-1"><h2 id={`score-audit-${raceId}`} className="mg-h2">Score record</h2><p className="mg-meta mt-1">Revision {score?.revision ?? 0}</p></div>
        <button type="button" className="mg-icon-btn" aria-label="Refresh score record" onClick={() => void load()} disabled={loading || busy}><RefreshCw aria-hidden="true" className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
      </div>

      {error && <p role="alert" className="border-b border-amber-300 bg-amber-50 p-4 text-amber-900">{error}</p>}
      {message && <p role="status" className="border-b border-emerald-300 bg-emerald-50 p-4 text-emerald-800">{message}</p>}

      {score && <div className="flex flex-col gap-4 p-4">
        <div className={`flex items-start gap-3 rounded-lg border p-3 ${score.isSignedOff ? 'border-emerald-300 bg-emerald-50' : 'border-amber-300 bg-amber-50'}`}>
          {score.isSignedOff ? <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" /> : <LockOpen aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />}
          <div className="min-w-0"><strong className="text-[rgb(var(--mg-heading))]">{score.isSignedOff ? 'Signed off' : 'Open for scoring'}</strong>{score.signedOffAt && <p className="mg-meta mt-1">{new Date(score.signedOffAt).toLocaleString('en-GB')}{score.signedOffByUserId ? <> · Actor <code className="break-all">{score.signedOffByUserId}</code></> : null}</p>}</div>
        </div>

        {canEdit() && <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-[rgb(var(--mg-heading))]" htmlFor={`score-action-reason-${raceId}`}>{score.isSignedOff ? 'Reason for reopening' : 'Sign-off note (optional)'}</label>
          <textarea id={`score-action-reason-${raceId}`} className="min-h-20 rounded-[10px] border-[1.5px] border-[rgb(var(--mg-control))] bg-white p-3 text-base focus:border-[rgb(var(--mg-heading))] focus:outline-none" value={actionReason} onChange={(event) => setActionReason(event.target.value)} maxLength={1000} />
          <button type="button" className="mg-btn mg-btn-primary self-start" disabled={busy || loading} onClick={() => void changeSignOff(!score.isSignedOff)}>{score.isSignedOff ? 'Reopen results' : 'Sign off results'}</button>
        </div>}

        {canEdit() && !score.isSignedOff && draft.length > 0 && <form className="flex flex-col gap-3 border-t border-[rgb(var(--mg-rule))] pt-4" onSubmit={updateScore}>
          <div><h3 className="mg-h2">Correct placings</h3><p className="mg-meta mt-1">Use the recorded team IDs below. Every correction needs a reason.</p></div>
          <div className="overflow-x-auto rounded-lg border border-[rgb(var(--mg-rule))]">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <thead className="bg-[rgb(var(--mg-subtle))] text-[rgb(var(--mg-heading))]"><tr><th className="px-3 py-2">Team</th><th className="px-3 py-2">Place</th><th className="px-3 py-2">Eliminated</th><th className="px-3 py-2">Points now</th></tr></thead>
              <tbody>{draft.map((result, index) => <tr key={result.teamId} className="border-t border-[rgb(var(--mg-rule-soft))]"><td className="px-3 py-2 font-semibold">Team {result.teamId}</td><td className="px-3 py-2"><input aria-label={`Place for team ${result.teamId}`} className="h-11 w-20 rounded-lg border border-[rgb(var(--mg-control))] px-2" type="number" min="1" disabled={result.eliminated} value={result.place || 1} onChange={(event) => setDraft((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, place: Number(event.target.value) } : item))} /></td><td className="px-3 py-2"><input aria-label={`Eliminated team ${result.teamId}`} className="h-5 w-5 accent-[rgb(var(--mg-button))]" type="checkbox" checked={result.eliminated} onChange={(event) => setDraft((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, eliminated: event.target.checked } : item))} /></td><td className="px-3 py-2">{result.points}</td></tr>)}</tbody>
            </table>
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-[rgb(var(--mg-heading))]">Correction reason<textarea className="min-h-20 rounded-[10px] border-[1.5px] border-[rgb(var(--mg-control))] bg-white p-3 text-base font-normal focus:border-[rgb(var(--mg-heading))] focus:outline-none" required maxLength={1000} value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} /></label>
          <button type="submit" className="mg-btn mg-btn-primary self-start" disabled={busy || loading}><Save aria-hidden="true" className="h-4 w-4" />{busy ? 'Saving…' : 'Save correction'}</button>
        </form>}

        <div className="border-t border-[rgb(var(--mg-rule))] pt-4">
          <h3 className="mg-h2">History</h3>
          {history.length === 0
            ? <p className="mg-meta mt-2">No score changes have been recorded yet.</p>
            : <ol className="mt-2 flex flex-col gap-2">{history.map((entry) => <li key={entry.revision} className="rounded-lg bg-[rgb(var(--mg-subtle))] p-3 text-sm"><div className="flex flex-wrap gap-x-2"><strong className="text-[rgb(var(--mg-heading))]">{eventLabel(entry.kind)}</strong><span className="mg-meta">Revision {entry.revision} · {new Date(entry.createdAt).toLocaleString('en-GB')}</span></div><p className="mt-1">{entry.reason}</p>{entry.actorUserId && <p className="mg-meta mt-1">Actor <code className="break-all">{entry.actorUserId}</code></p>}<p className="mg-meta mt-1">{scoreSummary(entry.before)} → {scoreSummary(entry.after)}</p></li>)}</ol>}
        </div>
      </div>}
    </section>
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
