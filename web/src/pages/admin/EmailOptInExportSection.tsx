import { useEffect, useState } from 'react';
import { Download, Send } from 'lucide-react';
import { api } from '../../api';
import { downloadCsv } from '../../lib/csv';

interface EmailStatus {
  enabled: boolean;
  configured: boolean;
  fromMasked?: string | null;
}

/** Site admins only: downloads everyone currently opted in to new-competition emails, with when and which wording, and checks Resend status. */
export function EmailOptInExportSection() {
  const [busy, setBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [testNotice, setTestNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<EmailStatus>('/admin/email-status')
      .then((r) => {
        if (r?.data && typeof r.data === 'object' && 'configured' in r.data) {
          setStatus(r.data);
        }
      })
      .catch(() => {});
  }, []);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.get<string>('/admin/email-opt-ins.csv', { responseType: 'text' });
      downloadCsv(`email-opt-ins-${new Date().toISOString().slice(0, 10)}.csv`, data);
    } catch {
      setError('Could not download the list. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setTestBusy(true);
    setError(null);
    setTestNotice(null);
    try {
      const { data } = await api.post<{ status: string; recipientMasked: string }>('/admin/email-test');
      if (data.status === 'Sent') {
        setTestNotice(`Test email sent to ${data.recipientMasked}.`);
      } else if (data.status === 'NotSent') {
        setTestNotice('Email sending is currently off in settings.');
      } else {
        setError('Could not send the test email. Check your Resend settings and try again.');
      }
    } catch {
      setError('Could not send the test email. Try again.');
    } finally {
      setTestBusy(false);
    }
  }

  return (
    <section className="mg-card mb-4 space-y-2 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="mg-h2 flex items-center gap-2">Email opt-ins</h2>
        {status && (
          <span
            className={`mg-tag inline-flex items-center gap-1.5 !rounded-full !px-2.5 !py-0.5 ${
              status.configured ? 'mg-tag-ok' : 'mg-tag-late'
            }`}
          >
            {status.configured ? (
              <>
                <span>Active (Resend)</span>
                {status.fromMasked && <span className="font-normal opacity-80">· {status.fromMasked}</span>}
              </>
            ) : (
              'Off (logging only — set Email__Enabled, Email__ApiKey and Email__From)'
            )}
          </span>
        )}
      </div>
      <p className="m-0 text-sm text-[rgb(var(--mg-body))]">
        People who ticked the box to hear when new competitions open. The list only holds those who have not unsubscribed.
        It contains personal data: keep it in your mailing tool and delete the file afterwards.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="mg-btn mg-btn-secondary !min-h-11 !px-3.5 text-sm" onClick={() => void download()} disabled={busy}>
          <Download className="h-4 w-4" aria-hidden="true" /> {busy ? 'Preparing…' : 'Download opt-in list (CSV)'}
        </button>
        <button type="button" className="mg-btn mg-btn-secondary !min-h-11 !px-3.5 text-sm" onClick={() => void sendTest()} disabled={testBusy}>
          <Send className="h-4 w-4" aria-hidden="true" /> {testBusy ? 'Sending…' : 'Send test email'}
        </button>
      </div>
      {testNotice && <p className="m-0 text-sm font-medium text-[rgb(var(--mg-ok))]">{testNotice}</p>}
      {error && <p role="alert" className="m-0 text-sm font-semibold text-[rgb(var(--mg-elim))]">{error}</p>}
    </section>
  );
}
