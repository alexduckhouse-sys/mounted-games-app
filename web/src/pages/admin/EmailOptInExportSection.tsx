import { useState } from 'react';
import { Download } from 'lucide-react';
import { api } from '../../api';
import { downloadCsv } from '../../lib/csv';

/** Site admins only: downloads everyone currently opted in to new-competition emails, with when and which wording. */
export function EmailOptInExportSection() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <section className="card mb-4 space-y-2 p-5">
      <h2 className="flex items-center gap-2 font-semibold">Email opt-ins</h2>
      <p className="m-0 text-sm text-slate-600 dark:text-slate-300">
        People who ticked the box to hear when new competitions open. The list only holds those who have not unsubscribed.
        It contains personal data: keep it in your mailing tool and delete the file afterwards.
      </p>
      <button type="button" className="btn-ghost" onClick={() => void download()} disabled={busy}>
        <Download className="h-4 w-4" aria-hidden="true" /> {busy ? 'Preparing…' : 'Download opt-in list (CSV)'}
      </button>
      {error && <p role="alert" className="m-0 text-sm font-semibold text-red-600">{error}</p>}
    </section>
  );
}
