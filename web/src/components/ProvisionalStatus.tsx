import { useState } from 'react';
import { CircleCheck, Clock3, TriangleAlert } from 'lucide-react';
import { api } from '../api';
import { apiErrorMessage } from '../lib/apiError';
import { countdownText } from '../lib/provisionalCountdown';
import type { SessionProvisionalState } from '../lib/provisionalResults';

const TONE: Record<string, string> = {
  provisional: 'bg-[rgb(var(--mg-late-bg))] text-[rgb(var(--mg-late-ink))]',
  'under-review-hold': 'bg-[rgb(var(--mg-problem-bg))] text-[rgb(var(--mg-problem-ink))]',
  official: 'bg-[rgb(var(--mg-done-bg))] text-[rgb(var(--mg-ok))]',
};

/**
 * The results pill on a finished session or section: provisional with the time left for queries, held while a
 * result is under review, or official. Nothing while the session is still running.
 */
export function ProvisionalBadge({ state, className = '' }: { state: SessionProvisionalState | null; className?: string }) {
  if (!state || state.status === 'in-progress') return null;
  const Icon = state.status === 'official' ? CircleCheck : state.status === 'provisional' ? Clock3 : TriangleAlert;
  const text = state.status === 'official'
    ? 'Official'
    : state.status === 'provisional'
      ? `Provisional · ${countdownText(state.remainingSeconds)} left for queries`
      : 'Provisional · result under review';
  const label = state.status === 'provisional'
    ? `Results provisional, ${state.remainingMinutes} ${state.remainingMinutes === 1 ? 'minute' : 'minutes'} left for queries`
    : state.status === 'official' ? 'Results official' : 'Results provisional while a result is under review';
  return (
    <span role="status" aria-label={label}
      className={`inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-semibold leading-none tabular-nums ${TONE[state.status]} ${className}`.trim()}>
      <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
      <span aria-hidden="true">{text}</span>
    </span>
  );
}

/**
 * Staff control beside the pill. While results are provisional it confirms them official at once; once official it
 * can reopen a fresh query window. The server refuses while a result is under review, and the reason is shown.
 */
export function ConfirmOfficialButton({ competitionId, sessionId, state, onDone }: {
  competitionId: number;
  sessionId: number;
  state: SessionProvisionalState | null;
  onDone?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!state || state.status === 'in-progress') return null;
  const reopen = state.status === 'official';

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/competitions/${competitionId}/sessions/${sessionId}/confirm-official`, reopen ? { reopenQueries: true } : {});
      onDone?.();
    } catch (err) {
      setError(apiErrorMessage(err, reopen ? 'Couldn’t reopen queries. Try again.' : 'Couldn’t confirm the results. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" className="mg-btn mg-btn-secondary !min-h-11 !px-3.5 text-sm" disabled={busy || state.status === 'under-review-hold'}
        onClick={() => { void send(); }}>
        {busy ? (reopen ? 'Reopening…' : 'Confirming…') : reopen ? 'Reopen for queries' : 'Confirm official now'}
      </button>
      {state.status === 'under-review-hold' && <span className="text-[13px] text-[rgb(var(--mg-muted))]">Settle the result under review first.</span>}
      {error && <span role="alert" className="text-[13px] font-semibold text-[rgb(var(--mg-problem-ink))]">{error}</span>}
    </span>
  );
}
