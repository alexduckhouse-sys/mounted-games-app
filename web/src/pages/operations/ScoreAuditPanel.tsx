import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { RefreshCw, Save } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useCompetition } from '../competition/context';
import { RefineDisclosure, RefineList, RefineNote, RefineSection } from '../refine/Refine';
import type { RaceScore, RaceScoreEventKind, RaceScoreHistory, ScorePlace } from './types';
import { apiMessage } from './types';
import { STATUS_CHOICES, effectiveStatus, statusLetter } from '../../lib/resultStatus';
import './operations.css';
import { SelectField } from '../../components/SelectField';
import { NumberField } from '../../components/NumberField';
import { formatPoints } from '../../lib/formatPoints';
import { manualPoints } from '../../lib/raceScoring';

type DraftScorePlace = ScorePlace & { pointsEdited?: boolean; pointsText?: string };

export function ScoreAuditPanel(props: { raceId: number; onChanged?: () => void }) {
  const { user } = useAuth();
  return <ScoreAuditRecord key={`${props.raceId}:${user?.id ?? ''}`} {...props} />;
}

function ScoreAuditRecord({ raceId, onChanged }: { raceId: number; onChanged?: () => void }) {
  const { canManage } = useAuth();
  const { competition } = useCompetition();
  const [score, setScore] = useState<RaceScore | null>(null);
  const [history, setHistory] = useState<RaceScoreHistory[]>([]);
  const [draft, setDraft] = useState<DraftScorePlace[]>([]);
  const [correctionReason, setCorrectionReason] = useState('');
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
        places: draft.map((result) => {
          const explicitPoints = !result.eliminated && (
            result.pointsEdited
            || !Number.isInteger(result.points)
            || manualPoints(result.refereeNote ?? undefined) !== undefined
          )
            ? result.points
            : undefined;
          return {
            teamId: result.teamId, place: result.place, eliminated: result.eliminated,
            ...(result.eliminated ? { status: effectiveStatus(true, result.status) } : {}),
            ...(explicitPoints !== undefined ? { points: explicitPoints } : {}),
            ...(result.refereeNote != null ? { refereeNote: result.refereeNote } : {}),
          };
        }),
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

  if (loading) return <div><p role="status" className="rf-note">Loading score history…</p></div>;

  const heading = `score-audit-${raceId}`;
  return (
    <section aria-labelledby={heading}>
      <RefineSection title="Score record" meta={`Revision ${score?.revision ?? 0}`} />
      <h2 id={heading} className="sr-only">Score record</h2>
      {error && <p role="alert" className="mg-notice ops-alert">{error}</p>}
      {message && <p role="status" className="rf-note ops-ok">{message}</p>}

      {score && <>
        <RefineList as="div">
          <div className="rf-row">
            <span className="rf-grow">
              <span className="rf-t1">Revision {score.revision}</span>
            </span>
            <button type="button" className="rf-btn rf-btn-text" aria-label="Refresh score record" onClick={() => void load()} disabled={loading || busy}><RefreshCw aria-hidden="true" className={`h-4 w-4 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`} />Refresh</button>
          </div>
        </RefineList>

        {canManage(competition) && draft.length > 0 && <>
          <RefineSection title="Corrections" />
          <RefineList as="div">
            <RefineDisclosure title="Correct placings" sub="Every correction needs a reason">
              <form className="ops-form ops-panel" onSubmit={updateScore}>
                <ul className="ops-places">{draft.map((result, index) => (
                  <li key={result.teamId} className="ops-place">
                    <span className="rf-grow"><span className="rf-t1">Team {result.teamId}</span><span className="rf-t2">Points now {formatPoints(result.points)}</span></span>
                    <label className="rf-fld ops-place-field">Place<NumberField aria-label={`Place for team ${result.teamId}`}  min="1" disabled={result.eliminated} value={result.place || 1} onChange={(event) => setDraft((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, place: Number(event.target.value) } : item))} /></label>
                    <label className="rf-fld ops-place-field">Points<NumberField decimal aria-label={`Points for team ${result.teamId}`} min="0" step="0.5" disabled={result.eliminated} value={result.eliminated ? 0 : (result.pointsText ?? String(result.points))} onChange={(event) => {
                      const raw = event.target.value;
                      const parsed = Number(raw);
                      setDraft((current) => current.map((item, itemIndex) => itemIndex === index
                        ? { ...item, pointsText: raw, points: raw.trim() === '' || Number.isNaN(parsed) ? item.points : parsed, pointsEdited: true }
                        : item));
                    }} /></label>
                    <label className="ops-elim"><input aria-label={`Eliminated team ${result.teamId}`} type="checkbox" checked={result.eliminated} onChange={(event) => setDraft((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, eliminated: event.target.checked, status: event.target.checked ? effectiveStatus(true, item.status) : 0 } : item))} />Did not finish</label>
                    {result.eliminated && <label className="rf-fld ops-place-field">Why<SelectField aria-label={`Reason for team ${result.teamId}`} value={effectiveStatus(true, result.status)} onChange={(event) => setDraft((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, status: Number(event.target.value) } : item))}>{STATUS_CHOICES.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</SelectField></label>}
                    <label className="rf-fld ops-place-field">Referee note<input aria-label={`Referee note for team ${result.teamId}`} type="text" maxLength={500} value={result.refereeNote ?? ''} onChange={(event) => setDraft((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, refereeNote: event.target.value } : item))} /></label>
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
                {entry.actorUserId && <span className="rf-t2">By <code className="break-all">{entry.actorUserId}</code></span>}
                <span className="rf-t2">{scoreSummary(entry.before)} → {scoreSummary(entry.after)}</span>
              </span>
            </li>
          ))}</RefineList>}
      </>}
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
  return results.map((result) => result.eliminated ? `Team ${result.teamId}: ${statusLetter(true, result.status)}` : `Team ${result.teamId}: ${result.place}`).join(', ');
}
