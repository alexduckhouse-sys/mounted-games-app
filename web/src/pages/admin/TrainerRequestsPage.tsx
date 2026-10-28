import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Notice } from '../../components/Notice';
import { confirmDialog } from '../../components/ConfirmDialog';
import { apiErrorMessage } from '../../lib/apiError';
import type { TrainerRequest } from '../../types';
import { useT } from '../../i18n/LanguageContext';
import { tr } from '../../i18n/translate';
import { RefineHeader, RefineList, RefinePage, RefineStatus } from '../refine/Refine';
import '../operations/operations.css';

interface Done { userId: string; name: string; detail: string; result: 'approved' | 'declined' }

const detailOf = (r: TrainerRequest) => [r.requestedRole === 'Manager' ? tr('admin.accounts.req.teamManager') : tr('admin.accounts.req.trainer'), r.clubName ?? tr('admin.accounts.req.noClub'), r.email].filter(Boolean).join(' · ');

/** People asking to be trainers or team managers. Approve one or all; the ones you've dealt with stay below until you leave. */
export function TrainerRequestsPage() {
  const t = useT();
  const [requests, setRequests] = useState<TrainerRequest[] | null>(null);
  const [done, setDone] = useState<Done[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get<TrainerRequest[]>('/admin/trainer-requests')
      .then(({ data }) => { if (!cancelled) setRequests(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) { setRequests([]); setError(tr('admin.accounts.req.loadFailed')); } });
    return () => { cancelled = true; };
  }, []);

  /** Sends one decision. Resolves true when it went through; the request then moves to Done. */
  async function review(request: TrainerRequest, action: 'approve' | 'decline'): Promise<boolean> {
    try {
      await api.post(`/admin/trainer-requests/${encodeURIComponent(request.userId)}/${action}`);
      setRequests((current) => (current ?? []).filter((r) => r.userId !== request.userId));
      setDone((current) => [{ userId: request.userId, name: request.fullName, detail: detailOf(request), result: action === 'approve' ? 'approved' : 'declined' }, ...current]);
      window.dispatchEvent(new CustomEvent('mg:trainer-requests-changed', { detail: { userId: request.userId } }));
      return true;
    } catch (caught) {
      setError(apiErrorMessage(caught, t('admin.accounts.req.updateFailed', { name: request.fullName })));
      return false;
    }
  }

  async function one(request: TrainerRequest, action: 'approve' | 'decline') {
    if (action === 'decline' && !(await confirmDialog({ title: t('admin.accounts.req.declineTitle', { name: request.fullName }), message: t('admin.accounts.req.declineMessage'), confirmLabel: t('admin.accounts.req.decline'), destructive: true }))) return;
    setBusy(true);
    setError(null);
    await review(request, action);
    setBusy(false);
  }

  async function approveAll() {
    if (!requests || requests.length === 0) return;
    if (!(await confirmDialog({ title: requests.length === 1 ? t('admin.accounts.req.approveOneTitle') : t('admin.accounts.req.approveAllTitle', { count: requests.length }), message: t('admin.accounts.req.approveMessage'), confirmLabel: requests.length === 1 ? t('admin.accounts.req.approve') : t('admin.accounts.req.approveAll') }))) return;
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
      <RefineHeader back="/admin" backLabel={t('admin.accounts.backToSiteAdmin')} context={t('admin.accounts.siteAdmin')} title={t('admin.accounts.req.title')} />
      <div className="ops-cards ops-tt ops-admin" aria-busy={busy}>
        {error && <Notice>{error}</Notice>}
        <div className="ops-waiting-head">
          <h2 className="ops-waiting">{t('admin.accounts.req.waiting')}</h2>
          {waiting.length > 0 && <button type="button" className="rf-btn rf-btn-primary" disabled={busy} onClick={() => void approveAll()}>{t('admin.accounts.req.approveAll')}</button>}
        </div>
        {requests === null && <p role="status" className="rf-note">{t('common.loading')}</p>}
        {requests !== null && (
          <RefineList as="div" label={t('admin.accounts.req.waiting')}>
            {waiting.map((request) => (
              <div key={request.userId} className="rf-row ops-comp-row">
                <span className="rf-grow ops-comp-name"><span className="rf-t1">{request.fullName}</span><span className="rf-t2">{detailOf(request)}</span></span>
                <button type="button" className="rf-btn" aria-label={t('admin.accounts.req.approveAria', { name: request.fullName })} disabled={busy} onClick={() => void one(request, 'approve')}>{t('admin.accounts.req.approve')}</button>
                <button type="button" className="ops-danger-link" aria-label={t('admin.accounts.req.declineAria', { name: request.fullName })} disabled={busy} onClick={() => void one(request, 'decline')}>{t('admin.accounts.req.decline')}</button>
              </div>
            ))}
            {waiting.length === 0 && <div className="rf-row"><span className="rf-t2">{t('admin.accounts.req.noneWaiting')}</span></div>}
          </RefineList>
        )}

        {done.length > 0 && (
          <>
            <h2 className="rf-sec ops-tt-head"><span>{t('admin.accounts.req.done')}</span></h2>
            <RefineList as="div" label={t('admin.accounts.req.done')}>
              {done.map((item) => (
                <div key={item.userId} className="rf-row">
                  <span className="rf-grow"><span className="rf-t1">{item.name}</span><span className="rf-t2">{item.detail}</span></span>
                  <RefineStatus tone={item.result === 'approved' ? 'ok' : 'mut'}>{t(item.result === 'approved' ? 'admin.accounts.req.approved' : 'admin.accounts.req.declined')}</RefineStatus>
                </div>
              ))}
            </RefineList>
          </>
        )}
      </div>
    </RefinePage>
  );
}
