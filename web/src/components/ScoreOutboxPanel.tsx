import { useState } from 'react';
import { CloudOff, AlertTriangle } from 'lucide-react';
import { describePlacings, discard, overrule, retry, type QueuedScore } from '../offline/scoreOutbox';
import { flushOutbox, OUTBOX_STORAGE_ERROR, updateOutbox, useScoreOutbox } from '../offline/useScoreOutbox';
import { confirmDialog } from './ConfirmDialog';

/** Results saved on this phone that haven't reached the server yet, and any that need a decision. */
export function ScoreOutboxPanel({ competitionId }: { competitionId: number }) {
  const queued = useScoreOutbox().filter((q) => q.competitionId === competitionId);
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [storageError, setStorageError] = useState(false);
  const update = (change: (list: QueuedScore[]) => QueuedScore[]) => setStorageError(!updateOutbox(change));
  if (queued.length === 0 && !storageError) return null;
  const waiting = queued.filter((q) => q.state === 'waiting');

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
      {waiting.length > 0 && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <CloudOff className="h-4 w-4 shrink-0" />
          <p className="flex-1">
            {waiting.length === 1 ? `${waiting[0].label} is` : `${waiting.length} races are`} saved on this phone and will send when you have signal.
          </p>
          <button className="btn-ghost min-h-11" onClick={() => void flushOutbox()}>Send now</button>
        </div>
      )}
    </div>
  );
}
