import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Notice } from '../../components/Notice';
import { useT } from '../../i18n/LanguageContext';
import { tr } from '../../i18n/translate';
import { problemMessage } from '../../lib/apiError';
import { RefineList, RefineSection } from '../refine/Refine';
import { isEntriesDigestStatus, type EntriesDigestStatus } from './entriesDigestTypes';
import { events, lastRunText, nextSendText, people } from './entriesDigestText';

/** Site admins: what the daily "entries are open" email is waiting to announce, how the last one went, and a Send now button. */
export function EntriesDigestCard() {
  const t = useT();
  const [status, setStatus] = useState<EntriesDigestStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    api.get<EntriesDigestStatus>('/admin/entries-digest')
      .then(({ data }) => { if (alive.current) { if (isEntriesDigestStatus(data)) setStatus(data); else setUnavailable(true); } })
      .catch(() => { if (alive.current) setUnavailable(true); });
    return () => { alive.current = false; };
  }, []);

  const send = useCallback(async (current: EntriesDigestStatus) => {
    setBusy(true);
    setError(null);
    try {
      let latest = current;
      let previousRemaining = current.last?.status === 0 ? current.last.remaining : null;
      // Each call works for a short while; carry on until nobody is left.
      for (let guard = 0; guard < 500; guard += 1) {
        const { data } = await api.post<EntriesDigestStatus>('/admin/entries-digest/send', { confirm: true, expectedRecipients: current.recipients });
        if (!isEntriesDigestStatus(data)) throw new Error('unexpected answer');
        latest = data;
        if (alive.current) setStatus(data);
        if (!alive.current || !data.last || data.last.status !== 0 || data.last.remaining === 0) break;
        // Recipients waiting out the retry delay stay in "remaining" but can't be claimed yet: stop when a call sent nobody.
        if (previousRemaining !== null && data.last.remaining >= previousRemaining) break;
        previousRemaining = data.last.remaining;
      }
      return latest;
    } catch (caught) {
      if (alive.current) setError(problemMessage(caught, tr('admin.email.digest.errSend')));
      return null;
    } finally {
      if (alive.current) setBusy(false);
    }
  }, []);

  async function sendNow() {
    if (!status) return;
    const ok = await confirmDialog({
      title: tr('admin.email.digest.confirmTitle'),
      message: tr('admin.email.digest.confirmMessage', { people: people(status.recipients), events: events(status.pendingCount) }),
      confirmLabel: tr('admin.email.digest.sendNow'),
    });
    if (ok) await send(status);
  }

  const unfinished = status?.last?.status === 0 && status.last.remaining > 0;
  const canPress = !!status && status.canSend && !busy && (unfinished || (status.pendingCount > 0 && status.recipients > 0 && !status.todayClaimed));

  return (
    <>
      <RefineSection title={t('admin.email.digest.title')} />
      <RefineList as="div" label={t('admin.email.digest.title')}>
        <div className="rf-row">
          <span className="rf-grow">
            <span className="rf-t2">
              {t('admin.email.digest.intro')}
            </span>
          </span>
        </div>
        {unavailable && <div className="rf-row"><span className="rf-t2" role="status">{t('admin.email.digest.unavailable')}</span></div>}
        {!status && !unavailable && <div className="rf-row"><span className="rf-t2" role="status">{t('common.loading')}</span></div>}
        {status && (
          <>
            <div className="rf-row">
              <span className="rf-grow">
                <span className="rf-t1">{t('admin.email.digest.waiting')}</span>
                <span className="rf-t2">
                  {status.pendingCount === 0
                    ? t('admin.email.digest.nothingNew')
                    : t(status.pendingCount > status.pending.length ? 'admin.email.digest.pendingMore' : 'admin.email.digest.pendingList', { events: events(status.pendingCount), names: status.pending.map((c) => c.name).join(', ') })}
                </span>
              </span>
            </div>
            <div className="rf-row"><span className="rf-grow"><span className="rf-t1">{t('admin.email.digest.onList')}</span><span className="rf-t2">{people(status.recipients)}</span></span></div>
            <div className="rf-row">
              <span className="rf-grow">
                <span className="rf-t1">{t('admin.email.digest.lastEmail')}</span>
                <span className="rf-t2">{status.last ? lastRunText(status.last) : t('admin.email.digest.noneYet')}</span>
              </span>
            </div>
            <div className="rf-row">
              <span className="rf-grow">
                <span className="rf-t1">{t('admin.email.digest.next')}</span>
                <span className="rf-t2">{status.canSend ? (status.todayClaimed && !unfinished ? t('admin.email.digest.todayGone', { next: nextSendText(status.nextSendUtc) }) : nextSendText(status.nextSendUtc)) : status.cannotSendBecause}</span>
              </span>
              <button type="button" className="rf-btn" disabled={!canPress} onClick={() => void sendNow()}>
                {busy ? t('admin.email.digest.busy') : unfinished ? t('admin.email.digest.carryOn') : t('admin.email.digest.sendNow')}
              </button>
            </div>
          </>
        )}
      </RefineList>
      {error && <Notice>{error}</Notice>}
    </>
  );
}
