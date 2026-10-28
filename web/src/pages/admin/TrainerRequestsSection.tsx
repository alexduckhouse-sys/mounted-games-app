import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { apiErrorMessage } from '../../lib/apiError';
import { initialsOf } from '../../lib/profile';
import type { TrainerRequest } from '../../types';
import { useT } from '../../i18n/LanguageContext';
import { activeLocale, tr } from '../../i18n/translate';
import { PartHead } from './LaptopParts';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Notice } from '../../components/Notice';
import { AnimatePresence } from 'framer-motion';
import { LeavingRow } from '../../components/LeavingRow';

export function TrainerRequestsSection() {
  const t = useT();
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
      if (!cancelled) setError(tr('admin.accounts.req.loadFailed'));
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
    if (action === 'decline' && !(await confirmDialog({ title: t('admin.accounts.req.declineTitle', { name: request.fullName }), message: t('admin.accounts.req.declineMessage'), confirmLabel: t('admin.accounts.req.decline'), destructive: true }))) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/trainer-requests/${encodeURIComponent(request.userId)}/${action}`);
      await load();
      window.dispatchEvent(new CustomEvent('mg:trainer-requests-changed', { detail: { userId: request.userId } }));
    } catch (err) {
      setError(apiErrorMessage(err, t('admin.accounts.sect.updateFailed')));
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
      setError(t('admin.accounts.req.loadFailed'));
    } finally {
      setLoading(false);
    }
  }

  // The date goes where the language puts it: split the sentence around a marker.
  const [requestedBefore, requestedAfter = ''] = t('admin.accounts.sect.requested', { time: '\u0001' }).split('\u0001');
  return (
    <section className="flex flex-col gap-3" aria-labelledby="trainer-requests-title">
      <PartHead id="trainer-requests-title" title={t('admin.accounts.sect.title')} meta={requests.length > 0 ? requests.length : undefined} alert />
      {error && <Notice actionLabel={t('admin.accounts.sect.refreshList')} onAction={refresh} actionDisabled={busy || loading}>{error}</Notice>}
      {loading ? <p role="status" className="mg-meta">{t('admin.accounts.sect.loading')}</p> : (
        <>
          {!error && requests.length === 0 && <p className="mg-card p-4 text-sm text-[rgb(var(--mg-muted))]">{t('admin.accounts.sect.none')}</p>}
          {requests.length > 0 && (
            <ul className="mg-card mg-list">
              <AnimatePresence initial={false}>
              {requests.map((request) => (
                <LeavingRow key={request.userId} className="grid grid-cols-[40px_minmax(0,1fr)] items-center gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[40px_minmax(0,1fr)_192px]">
                  <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full bg-[rgb(var(--mg-tint))] text-[15px] font-bold text-[rgb(var(--mg-heading))]">{initialsOf(request.fullName, request.email)}</span>
                  <div className="flex min-w-0 flex-col gap-[3px] break-words">
                    <strong className="text-base font-semibold">{request.fullName}</strong>
                    <span className="text-[13px] text-[rgb(var(--mg-muted))]">{request.requestedRole === 'Manager' ? t('admin.accounts.req.teamManager') : t('admin.accounts.req.trainer')} · <span>{request.clubName ?? t('admin.accounts.req.noClub')}</span></span>
                    <span className="text-xs text-[rgb(var(--mg-muted))]">{request.email && <span>{request.email}</span>}{request.email && ' · '}{requestedBefore}<time dateTime={request.requestedAt}>{new Date(request.requestedAt).toLocaleString(activeLocale())}</time>{requestedAfter}</span>
                  </div>
                  <div className="col-span-2 grid grid-cols-2 gap-2 sm:col-span-1">
                    <button type="button" className="mg-btn mg-btn-primary !min-h-11 !rounded-[10px]" disabled={busy || !!error} onClick={() => review(request, 'approve')}>{t('admin.accounts.req.approve')}</button>
                    <button type="button" className="mg-btn mg-btn-secondary !min-h-11 !rounded-[10px]" disabled={busy || !!error} onClick={() => review(request, 'decline')}>{t('admin.accounts.req.decline')}</button>
                  </div>
                </LeavingRow>
              ))}
              </AnimatePresence>
            </ul>
          )}
        </>
      )}
    </section>
  );
}
