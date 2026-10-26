import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { apiErrorMessage } from '../../lib/apiError';
import { initialsOf } from '../../lib/profile';
import type { TrainerRequest } from '../../types';
import { PartHead } from './LaptopParts';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Notice } from '../../components/Notice';

export function TrainerRequestsSection() {
  const [requests, setRequests] = useState<TrainerRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await api.get<TrainerRequest[]>('/admin/trainer-requests');
    setRequests(data);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.get<TrainerRequest[]>('/admin/trainer-requests').then(({ data }) => {
      if (!cancelled) setRequests(data);
    }).catch(() => {
      if (!cancelled) setError('Couldn’t load the trainer requests. Check your signal and try again.');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    function onRequestsChanged(e: Event) {
      const removedId = (e as CustomEvent<{ userId?: string }>).detail?.userId;
      if (!removedId) return;
      setRequests((cur) => cur.filter((r) => r.userId !== removedId));
    }
    window.addEventListener('mg:trainer-requests-changed', onRequestsChanged);
    return () => window.removeEventListener('mg:trainer-requests-changed', onRequestsChanged);
  }, []);

  async function review(request: TrainerRequest, action: 'approve' | 'decline') {
    if (action === 'decline' && !(await confirmDialog({ title: `Decline ${request.fullName}’s request?`, message: 'Their account stays a member.', confirmLabel: 'Decline', destructive: true }))) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/trainer-requests/${encodeURIComponent(request.userId)}/${action}`);
      await load();
      window.dispatchEvent(new CustomEvent('mg:trainer-requests-changed', { detail: { userId: request.userId } }));
    } catch (err) {
      setError(apiErrorMessage(err, 'Couldn’t update the trainer requests. Refresh the list and try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      await load();
    } catch {
      setError('Couldn’t load the trainer requests. Check your signal and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby="trainer-requests-title">
      <PartHead id="trainer-requests-title" title="Waiting for you" meta={requests.length > 0 ? requests.length : undefined} alert />
      {error && <Notice actionLabel="Refresh list" onAction={refresh} actionDisabled={busy || loading}>{error}</Notice>}
      {loading ? <p role="status" className="mg-meta">Loading trainer requests…</p> : (
        <>
          {!error && requests.length === 0 && <p className="mg-card p-4 text-sm text-[rgb(var(--mg-muted))]">No trainer requests.</p>}
          {requests.length > 0 && (
            <ul className="mg-card mg-list">
              {requests.map((request) => (
                <li key={request.userId} className="grid grid-cols-[40px_minmax(0,1fr)] items-center gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[40px_minmax(0,1fr)_192px]">
                  <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full bg-[rgb(var(--mg-tint))] text-[15px] font-bold text-[rgb(var(--mg-heading))]">{initialsOf(request.fullName, request.email)}</span>
                  <div className="flex min-w-0 flex-col gap-[3px] break-words">
                    <strong className="text-base font-semibold">{request.fullName}</strong>
                    <span className="text-[13px] text-[rgb(var(--mg-muted))]">{request.requestedRole === 'Manager' ? 'Team manager' : 'Trainer'} · <span>{request.clubName ?? 'No club given'}</span></span>
                    <span className="text-xs text-[rgb(var(--mg-muted))]">{request.email && <span>{request.email}</span>}{request.email && ' · '}Requested <time dateTime={request.requestedAt}>{new Date(request.requestedAt).toLocaleString('en-GB')}</time></span>
                  </div>
                  <div className="col-span-2 grid grid-cols-2 gap-2 sm:col-span-1">
                    <button type="button" className="mg-btn mg-btn-primary !min-h-11 !rounded-[10px]" disabled={busy || !!error} onClick={() => review(request, 'approve')}>Approve</button>
                    <button type="button" className="mg-btn mg-btn-secondary !min-h-11 !rounded-[10px]" disabled={busy || !!error} onClick={() => review(request, 'decline')}>Decline</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
