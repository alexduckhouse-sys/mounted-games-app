import { useEffect, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import { api } from '../../api';
import { resultsDigest } from '../../lib/resultsDigest';
import type { ResultsBook } from './resultsBookTypes';

type Outcome = { kind: 'copied' } | { kind: 'manual'; text: string } | { kind: 'failed' };

/**
 * Copies the results as plain text to paste into a message. It always builds the text from the public results book,
 * so the organiser copy fetches the public one rather than reusing its own private data. Nothing is sent anywhere.
 */
export function CopyResults({ book }: { book: ResultsBook }) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const id = book.competition.id;

  useEffect(() => {
    if (outcome?.kind === 'manual') { box.current?.focus(); box.current?.select(); }
  }, [outcome]);

  async function copy() {
    setBusy(true); setOutcome(null);
    let text: string;
    try {
      const publicBook = book.includesPrivate ? (await api.get<ResultsBook>(`/event-tools/competitions/${id}/results-book`)).data : book;
      text = `${resultsDigest(publicBook)}\n\nFull results: ${window.location.origin}/competitions/${id}/toplists`;
    } catch {
      setOutcome({ kind: 'failed' }); setBusy(false); return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setOutcome({ kind: 'copied' });
    } catch {
      setOutcome({ kind: 'manual', text });
    }
    setBusy(false);
  }

  return <div className="event-print-controls w-full">
    <button type="button" className="mg-btn mg-btn-secondary" disabled={busy} onClick={() => void copy()}>
      <Copy className="h-4 w-4" aria-hidden="true" />{busy ? 'Getting the results…' : 'Copy results'}
    </button>
    <div role="status" className="mt-2 text-sm">
      {outcome?.kind === 'copied' && 'Copied. Paste it into your message.'}
      {outcome?.kind === 'failed' && 'Couldn’t get the results. Check your signal and try again.'}
    </div>
    {outcome?.kind === 'manual' && <label className="mt-2 block text-sm">
      Couldn’t copy automatically. Select this text and copy it yourself.
      <textarea ref={box} readOnly rows={8} value={outcome.text} onFocus={(event) => event.currentTarget.select()}
        className="mt-1 block w-full rounded-lg border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-surface))] p-2 text-[16px] text-[rgb(var(--mg-ink))]" />
    </label>}
  </div>;
}
