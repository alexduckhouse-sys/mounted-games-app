import { useEffect, useState } from 'react';
import { api } from '../../api';
import { confirmDialog } from '../../components/ConfirmDialog';
import { apiErrorMessage } from '../../lib/apiError';
import type { TrainerRequest } from '../../types';
import { RefineHeader, RefineList, RefinePage, RefineStatus } from '../refine/Refine';
import '../operations/operations.css';

interface Done { userId: string; name: string; detail: string; result: 'Approved' | 'Declined' }

const detailOf = (r: TrainerRequest) => [r.requestedRole === 'Manager' ? 'Team manager' : 'Trainer', r.clubName ?? 'No club given', r.email].filter(Boolean).join(' · ');

/** People asking to be trainers or team managers. Approve one or all; the ones you've dealt with stay below until you leave. */
export function TrainerRequestsPage() {
  const [requests, setRequests] = useState<TrainerRequest[] | null>(null);
  const [done, setDone] = useState<Done[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get<TrainerRequest[]>('/admin/trainer-requests')
      .then(({ data }) => { if (!cancelled) setRequests(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) { setRequests([]); setError('Couldn’t load the trainer requests. Try again.'); } });
    return () => { cancelled = true; };
  }, []);

  /** Sends one decision. Resolves true when it went through; the request then moves to Done. */
  async function review(request: TrainerRequest, action: 'approve' | 'decline'): Promise<boolean> {
    try {
      await api.post(`/admin/trainer-requests/${encodeURIComponent(request.userId)}/${action}`);
      setRequests((current) => (current ?? []).filter((r) => r.userId !== request.userId));
      setDone((current) => [{ userId: request.userId, name: request.fullName, detail: detailOf(request), result: action === 'approve' ? 'Approved' : 'Declined' }, ...current]);
      window.dispatchEvent(new CustomEvent('mg:trainer-requests-changed', { detail: { userId: request.userId } }));
      return true;
    } catch (caught) {
      setError(apiErrorMessage(caught, `Couldn’t update ${request.fullName}’s request. Try again.`));
      return false;
    }
  }

  async function one(request: TrainerRequest, action: 'approve' | 'decline') {
    if (action === 'decline' && !(await confirmDialog({ title: `Decline ${request.fullName}’s request?`, message: 'Their account stays a member.', confirmLabel: 'Decline', destructive: true }))) return;
    setBusy(true);
    setError(null);
    await review(request, action);
    setBusy(false);
  }

  async function approveAll() {
    if (!requests || requests.length === 0) return;
    if (!(await confirmDialog({ title: requests.length === 1 ? 'Approve this request?' : `Approve all ${requests.length} requests?`, message: 'They get the access they asked for.', confirmLabel: requests.length === 1 ? 'Approve' : 'Approve all' }))) return;
    setBusy(true);
    setError(null);
    for (const request of requests) {
      if (!(await review(request, 'approve'))) break;
    }
    setBusy(false);
  }

  const waiting = requests ?? [];
  return (
    <RefinePage>
      <RefineHeader back="/admin" backLabel="Back to site admin" context="Site admin" title="Trainer requests" />
      <div className="ops-cards ops-tt ops-admin" aria-busy={busy}>
        {error && <p role="alert" className="mg-notice ops-alert">{error}</p>}
        <div className="ops-waiting-head">
          <h2 className="ops-waiting">Waiting</h2>
          {waiting.length > 0 && <button type="button" className="rf-btn rf-btn-primary" disabled={busy} onClick={() => void approveAll()}>Approve all</button>}
        </div>
        {requests === null && <p role="status" className="rf-note">Loading…</p>}
        {requests !== null && (
          <RefineList as="div" label="Waiting">
            {waiting.map((request) => (
              <div key={request.userId} className="rf-row ops-comp-row">
                <span className="rf-grow ops-comp-name"><span className="rf-t1">{request.fullName}</span><span className="rf-t2">{detailOf(request)}</span></span>
                <button type="button" className="rf-btn" aria-label={`Approve ${request.fullName}`} disabled={busy} onClick={() => void one(request, 'approve')}>Approve</button>
                <button type="button" className="ops-danger-link" aria-label={`Decline ${request.fullName}`} disabled={busy} onClick={() => void one(request, 'decline')}>Decline</button>
              </div>
            ))}
            {waiting.length === 0 && <div className="rf-row"><span className="rf-t2">No one waiting</span></div>}
          </RefineList>
        )}

        {done.length > 0 && (
          <>
            <h2 className="rf-sec ops-tt-head"><span>Done</span></h2>
            <RefineList as="div" label="Done">
              {done.map((item) => (
                <div key={item.userId} className="rf-row">
                  <span className="rf-grow"><span className="rf-t1">{item.name}</span><span className="rf-t2">{item.detail}</span></span>
                  <RefineStatus tone={item.result === 'Approved' ? 'ok' : 'mut'}>{item.result}</RefineStatus>
                </div>
              ))}
            </RefineList>
          </>
        )}
      </div>
    </RefinePage>
  );
}
