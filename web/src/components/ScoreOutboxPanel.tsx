import { useEffect, useState } from 'react';
import { CloudOff, AlertTriangle } from 'lucide-react';
import { describePlacings, discard, overrule, retry, type QueuedScore } from '../offline/scoreOutbox';
import { flushOutbox, OUTBOX_STORAGE_ERROR, updateOutbox, useScoreOutbox } from '../offline/useScoreOutbox';
import { confirmDialog } from './ConfirmDialog';
import { TickerNumber } from './TickerNumber';

/** How long a sent result stays ticked off before the row goes. */
export const SENT_SHOWN_MS = 2400;

/** Results saved on this phone that haven't reached the server yet, and any that need a decision. */
export function ScoreOutboxPanel({ competitionId }: { competitionId: number }) {
  const queued = useScoreOutbox().filter((q) => q.competitionId === competitionId);
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [storageError, setStorageError] = useState(false);
  const update = (change: (list: QueuedScore[]) => QueuedScore[]) => setStorageError(!updateOutbox(change));
  const waiting = queued.filter((q) => q.state === 'waiting');

  // A waiting result that leaves the outbox has been sent: tick it off. (Only conflicts and failures can be
  // deleted, and those have stopped waiting, so a deletion never counts as sent.)
  const waitingKey = waiting.map((q) => q.raceId).join(',');
  const [before, setBefore] = useState({ key: waitingKey, items: waiting.map((q) => ({ raceId: q.raceId, label: q.label })) });
  const [sent, setSent] = useState<{ raceId: number; label: string }[]>([]);
  if (before.key !== waitingKey) {
    const stillQueued = new Set(queued.map((q) => q.raceId));
    const gone = before.items.filter((item) => !stillQueued.has(item.raceId));
    setBefore({ key: waitingKey, items: waiting.map((q) => ({ raceId: q.raceId, label: q.label })) });
    if (gone.length > 0) setSent((current) => [...current.filter((item) => !gone.some((g) => g.raceId === item.raceId)), ...gone]);
  }
  const sentKey = sent.map((item) => item.raceId).join(',');
  useEffect(() => {
    if (!sentKey) return;
    const timer = setTimeout(() => setSent([]), SENT_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [sentKey]);

  if (queued.length === 0 && !storageError && sent.length === 0) return null;

  return (
    <div className="space-y-2">
      {storageError && <p role="alert" className="mg-notice">{OUTBOX_STORAGE_ERROR}</p>}
      {queued.filter((q) => q.state === 'conflict').map((q) => (
        <div key={q.raceId} role="alert" className="card space-y-2 border-amber-300 p-3 text-sm">
          <p className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" /> {q.label}: scored differently on another phone
          </p>
          <p className="text-slate-600 dark:text-slate-300">
            Another phone saved this race while yours were waiting to send. Choose which results to keep.
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="font-medium">Theirs</dt><dd>{describePlacings(q.theirs ?? [], q.teamNames)}</dd>
            <dt className="font-medium">Yours</dt><dd>{describePlacings(q.places, q.teamNames)}</dd>
          </dl>
          <label className="flex flex-col gap-1 font-semibold">Reason for replacing these results
            <textarea className="input" maxLength={1000} value={reasons[q.raceId] ?? q.reason ?? ''} onChange={(event) => setReasons((current) => ({ ...current, [q.raceId]: event.target.value }))} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost min-h-11" onClick={() => update((l) => discard(l, q.raceId))}>Keep theirs</button>
            <button className="btn-primary min-h-11" disabled={!(reasons[q.raceId] ?? q.reason ?? '').trim()} onClick={() => update((l) => overrule(l, q.raceId, (reasons[q.raceId] ?? q.reason ?? '').trim()))}>Use mine</button>
          </div>
        </div>
      ))}
      {queued.filter((q) => q.state === 'failed').map((q) => (
        <div key={q.raceId} role="alert" className="card space-y-2 p-3 text-sm">
          <p className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" /> {q.label} wasn’t saved
          </p>
          <p className="text-slate-600 dark:text-slate-300">{q.error} ({describePlacings(q.places, q.teamNames)})</p>
          <label className="flex flex-col gap-1 font-semibold">Reason for correction (if needed)
            <textarea className="input" maxLength={1000} value={reasons[q.raceId] ?? q.reason ?? ''} onChange={(event) => setReasons((current) => ({ ...current, [q.raceId]: event.target.value }))} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost min-h-11" onClick={async () => { if (await confirmDialog({ title: 'Delete your results?', message: `Delete your results for ${q.label}?`, confirmLabel: 'Delete results', destructive: true })) update((l) => discard(l, q.raceId)); }}>Delete mine</button>
            <button className="btn-primary min-h-11" onClick={() => update((l) => retry(l, q.raceId, (reasons[q.raceId] ?? q.reason ?? '').trim() || undefined))}>Try again</button>
          </div>
        </div>
      ))}
      {sent.map((item) => (
        <p key={item.raceId} role="status" className="mg-sent-row">
          <span className="mg-sent-tick" aria-hidden="true"><svg viewBox="0 0 24 24"><path pathLength={1} d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>
          {item.label} sent
        </p>
      ))}
      {waiting.length > 0 && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <CloudOff className="h-4 w-4 shrink-0" />
          <p className="flex-1">
            {waiting.length === 1 ? `${waiting[0].label} is` : <><TickerNumber value={waiting.length} format={String} /> races are</>} saved on this phone and will send when you have signal.
          </p>
          <button className="btn-ghost min-h-11" onClick={() => void flushOutbox()}>Send now</button>
        </div>
      )}
    </div>
  );
}
