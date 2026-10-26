import { useEffect, useState } from 'react';
import { CloudOff } from 'lucide-react';
import { describePlacings, discard, overrule, retry, type QueuedScore } from '../offline/scoreOutbox';
import { flushOutbox, OUTBOX_STORAGE_ERROR, updateOutbox, useScoreOutbox } from '../offline/useScoreOutbox';
import { confirmDialog } from './ConfirmDialog';
import { Notice } from './Notice';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { TickerNumber } from './TickerNumber';

/** Results saved on this phone that haven't reached the server yet, and any that need a decision. */
export function ScoreOutboxPanel({ competitionId }: { competitionId: number }) {
  const queued = useScoreOutbox().filter((q) => q.competitionId === competitionId);
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [storageError, setStorageError] = useState(false);
  const update = (change: (list: QueuedScore[]) => QueuedScore[]) => setStorageError(!updateOutbox(change));
  const waiting = queued.filter((q) => q.state === 'waiting');
  const conflict = queued.find((q) => q.state === 'conflict');
  const toast = useToast();
  const showToast = toast.show;

  // A waiting result that leaves the outbox has been sent: say so in a toast. (Only conflicts and failures can be
  // deleted, and those have stopped waiting, so a deletion never counts as sent.)
  const waitingKey = waiting.map((q) => q.raceId).join(',');
  const [before, setBefore] = useState({ key: waitingKey, items: waiting.map((q) => ({ raceId: q.raceId, label: q.label })) });
  const [sent, setSent] = useState<{ message: string } | null>(null);
  if (before.key !== waitingKey) {
    const stillQueued = new Set(queued.map((q) => q.raceId));
    const gone = before.items.filter((item) => !stillQueued.has(item.raceId));
    setBefore({ key: waitingKey, items: waiting.map((q) => ({ raceId: q.raceId, label: q.label })) });
    if (gone.length > 0) setSent({ message: gone.length === 1 ? `${gone[0].label} sent` : `${gone.length} races sent` });
  }
  useEffect(() => {
    if (sent) showToast(sent.message);
  }, [sent, showToast]);

  const reasonOf = (q: QueuedScore) => reasons[q.raceId] ?? q.reason ?? '';
  const setReason = (q: QueuedScore, value: string) => setReasons((current) => ({ ...current, [q.raceId]: value }));

  if (queued.length === 0 && !storageError) return <>{toast.node}</>;

  return (
    <div className="space-y-2">
      {storageError && <Notice>{OUTBOX_STORAGE_ERROR}</Notice>}
      {conflict && (
        <Sheet
          title={`${conflict.label} was scored on another phone too`}
          description="The results don’t match. Choose which to keep."
          onClose={() => undefined}
          dismissible={false}
        >
          <dl className="kit-sheet-text grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="font-semibold">Theirs</dt><dd>{describePlacings(conflict.theirs ?? [], conflict.teamNames)}</dd>
            <dt className="font-semibold">Yours</dt><dd>{describePlacings(conflict.places, conflict.teamNames)}</dd>
          </dl>
          <label className="kit-sheet-field">Reason for replacing these results
            <textarea className="input" maxLength={1000} value={reasonOf(conflict)} onChange={(event) => setReason(conflict, event.target.value)} />
          </label>
          <div className="kit-acts">
            <button type="button" className="kit-pill kit-pill-fill" onClick={() => update((l) => discard(l, conflict.raceId))}>Keep theirs</button>
            <button type="button" className="kit-pill" disabled={!reasonOf(conflict).trim()} onClick={() => update((l) => overrule(l, conflict.raceId, reasonOf(conflict).trim()))}>Use mine</button>
          </div>
        </Sheet>
      )}
      {queued.filter((q) => q.state === 'failed').map((q) => (
        <Notice
          key={q.raceId}
          actionLabel="Try again"
          onAction={() => update((l) => retry(l, q.raceId, reasonOf(q).trim() || undefined))}
          extra={(
            <>
              <label className="flex w-full flex-col gap-1 font-semibold">Reason for correction (if needed)
                <textarea className="input" maxLength={1000} value={reasonOf(q)} onChange={(event) => setReason(q, event.target.value)} />
              </label>
              <button type="button" className="kit-redtext" onClick={async () => { if (await confirmDialog({ title: 'Delete your results?', message: `Your results for ${q.label} on this phone go for good.`, confirmLabel: 'Delete results', destructive: true })) update((l) => discard(l, q.raceId)); }}>Delete mine</button>
            </>
          )}
        >
          {q.label} wasn’t saved. {q.error} ({describePlacings(q.places, q.teamNames)})
        </Notice>
      ))}
      {waiting.length > 0 && (
        <Notice tone="info" icon={CloudOff} actionLabel="Send now" onAction={() => void flushOutbox()}>
          {waiting.length === 1 ? `${waiting[0].label} is` : <><TickerNumber value={waiting.length} format={String} /> races are</>} saved on this phone and will send when you have signal.
        </Notice>
      )}
      {toast.node}
    </div>
  );
}
