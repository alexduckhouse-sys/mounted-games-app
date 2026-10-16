import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import type { TrainerRequest } from '../../types';

export function TrainerRequestsSection({ canReview }: { canReview: boolean }) {
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
      if (!cancelled) setError('Could not load trainer requests. Try again.');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  async function review(request: TrainerRequest, action: 'approve' | 'decline') {
    if (action === 'decline' && !window.confirm(`Decline the trainer request from ${request.fullName}? Their account will stay a member.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/trainer-requests/${encodeURIComponent(request.userId)}/${action}`);
      await load();
    } catch {
      setError('Could not update trainer requests. Refresh the list and try again.');
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
      setError('Could not load trainer requests. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card p-5" aria-labelledby="trainer-requests-title">
      <h2 id="trainer-requests-title" className="font-semibold mb-3">Trainer requests</h2>
      {error && <div role="alert" className="mb-3 text-sm text-rose-600 dark:text-rose-300">
        <p>{error}</p>
        <button type="button" className="btn-ghost mt-2" disabled={busy || loading} onClick={refresh}>Refresh list</button>
      </div>}
      {loading ? <p className="text-sm text-slate-500">Loading trainer requests…</p> : (
        <>
          {!error && requests.length === 0 && <p className="text-sm text-slate-500">No trainer requests.</p>}
          {requests.length > 0 && !canReview && <p className="mb-3 text-sm text-slate-500">Switch to edit mode to approve or decline requests.</p>}
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {requests.map((request) => (
              <li key={request.userId} className="py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 break-words">
                  <p className="font-medium">{request.fullName}</p>
                  <p className="text-sm">{request.email}</p>
                  <p className="text-sm text-slate-500">{request.clubName ?? 'No club given'}</p>
                  <p className="text-xs text-slate-500">Requested <time dateTime={request.requestedAt}>{new Date(request.requestedAt).toLocaleString('en-GB')}</time></p>
                </div>
                {canReview && <div className="flex gap-2">
                  <button type="button" className="btn-primary" disabled={busy || !!error} onClick={() => review(request, 'approve')}>Approve</button>
                  <button type="button" className="btn-ghost text-rose-600" disabled={busy || !!error} onClick={() => review(request, 'decline')}>Decline</button>
                </div>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
