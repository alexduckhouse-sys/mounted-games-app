import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Notice } from '../../components/Notice';
import { problemMessage } from '../../lib/apiError';
import { RefineList, RefineSection } from '../refine/Refine';
import { isEntriesDigestStatus, type EntriesDigestStatus } from './entriesDigestTypes';
import { events, lastRunText, nextSendText, people } from './entriesDigestText';

/** Site admins: what the daily "entries are open" email is waiting to announce, how the last one went, and a Send now button. */
export function EntriesDigestCard() {
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
      if (alive.current) setError(problemMessage(caught, 'Couldn’t send. Check your signal and try again.'));
      return null;
    } finally {
      if (alive.current) setBusy(false);
    }
  }, []);

  async function sendNow() {
    if (!status) return;
    const ok = await confirmDialog({
      title: 'Send it now?',
      message: `${people(status.recipients)} will get one email about ${events(status.pendingCount)}. That covers today’s evening email, so anything that opens later waits until tomorrow. You can’t unsend it.`,
      confirmLabel: 'Send now',
    });
    if (ok) await send(status);
  }

  const unfinished = status?.last?.status === 0 && status.last.remaining > 0;
  const canPress = !!status && status.canSend && !busy && (unfinished || (status.pendingCount > 0 && status.recipients > 0 && !status.todayClaimed));

  return (
    <>
      <RefineSection title="New-event emails" />
      <RefineList as="div" label="New-event emails">
        <div className="rf-row">
          <span className="rf-grow">
            <span className="rf-t2">
              Each evening, around 6pm UK time, everyone on the list gets one email with the competitions that have opened for entries since the last one. If nothing is new, nothing goes out.
            </span>
          </span>
        </div>
        {unavailable && <div className="rf-row"><span className="rf-t2" role="status">Couldn’t load this. Reload the page to try again.</span></div>}
        {!status && !unavailable && <div className="rf-row"><span className="rf-t2" role="status">Loading…</span></div>}
        {status && (
          <>
            <div className="rf-row">
              <span className="rf-grow">
                <span className="rf-t1">Waiting to go</span>
                <span className="rf-t2">
                  {status.pendingCount === 0
                    ? 'Nothing new'
                    : `${events(status.pendingCount)}: ${status.pending.map((c) => c.name).join(', ')}${status.pendingCount > status.pending.length ? ' and more' : ''}`}
                </span>
              </span>
            </div>
            <div className="rf-row"><span className="rf-grow"><span className="rf-t1">On the list</span><span className="rf-t2">{people(status.recipients)}</span></span></div>
            <div className="rf-row">
              <span className="rf-grow">
                <span className="rf-t1">Last email</span>
                <span className="rf-t2">{status.last ? lastRunText(status.last) : 'None yet'}</span>
              </span>
            </div>
            <div className="rf-row">
              <span className="rf-grow">
                <span className="rf-t1">Next</span>
                <span className="rf-t2">{status.canSend ? (status.todayClaimed && !unfinished ? 'Today’s has gone. ' : '') + nextSendText(status.nextSendUtc) : status.cannotSendBecause}</span>
              </span>
              <button type="button" className="rf-btn" disabled={!canPress} onClick={() => void sendNow()}>
                {busy ? 'Sending…' : unfinished ? 'Carry on' : 'Send now'}
              </button>
            </div>
          </>
        )}
      </RefineList>
      {error && <Notice>{error}</Notice>}
    </>
  );
}
