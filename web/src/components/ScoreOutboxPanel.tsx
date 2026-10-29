import { useEffect, useState } from 'react';
import { CloudOff } from 'lucide-react';
import { describePlacings, discard, overrule, retry, type QueuedScore } from '../offline/scoreOutbox';
import { flushOutbox, inFlightGraceRemainingMs, OUTBOX_STORAGE_ERROR, SCORE_SENT, updateOutbox, useScoreOutbox } from '../offline/useScoreOutbox';
import { confirmDialog } from './ConfirmDialog';
import { OutboxTransfer } from './OutboxTransfer';
import { Notice } from './Notice';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { TickerNumber } from './TickerNumber';

const scoreKey = (score: QueuedScore) => `${score.raceId}@${score.saveId ?? score.queuedAt}`;

/** Results saved on this phone that haven't reached the server yet, and any that need a decision. */
export function ScoreOutboxPanel({ competitionId, competitionName, alwaysImport = false, viaLink = false }: { competitionId: number; competitionName?: string; alwaysImport?: boolean; viaLink?: boolean }) {
  const queued = useScoreOutbox().filter((q) => q.competitionId === competitionId);
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [storageError, setStorageError] = useState(false);
  const update = (change: (list: QueuedScore[]) => QueuedScore[]) => setStorageError(!updateOutbox(change));
  const waiting = queued.filter((q) => q.state === 'waiting');
  const [keptOnPhone, setKeptOnPhone] = useState<Set<string>>(() => new Set());
  const conflict = queued.find((q) => q.state === 'conflict' && (!q.programmeChanged || !keptOnPhone.has(scoreKey(q))));
  const keepOnPhone = (score: QueuedScore) => setKeptOnPhone((current) => new Set(current).add(scoreKey(score)));
  const toast = useToast();
  const showToast = toast.show;

  // Only a flush that gets a save accepted counts as "sent". Deleting or undoing a waiting save never does.
  useEffect(() => {
    let labels: string[] = [];
    let timer: number | undefined;
    const onSent = (event: Event) => {
      const detail = (event as CustomEvent<{ competitionId: number; label: string }>).detail;
      if (detail?.competitionId !== competitionId) return;
      labels.push(detail.label);
      timer ??= window.setTimeout(() => {
        showToast(labels.length === 1 ? `${labels[0]} sent` : `${labels.length} races sent`);
        labels = [];
        timer = undefined;
      }, 50);
    };
    window.addEventListener(SCORE_SENT, onSent);
    return () => { window.removeEventListener(SCORE_SENT, onSent); window.clearTimeout(timer); };
  }, [competitionId, showToast]);

  // A normal online save is out within a moment, so the "saved on this phone" notice waits out the grace period.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const graceLeft = Math.max(0, ...waiting.map((q) => inFlightGraceRemainingMs(q, nowMs)));
  useEffect(() => {
    if (graceLeft <= 0) return;
    const timer = window.setTimeout(() => setNowMs(Date.now()), graceLeft + 20);
    return () => window.clearTimeout(timer);
  }, [graceLeft]);
  const showWaiting = waiting.filter((q) => inFlightGraceRemainingMs(q, nowMs) === 0);

  const reasonOf = (q: QueuedScore) => reasons[q.raceId] ?? q.reason ?? '';
  const setReason = (q: QueuedScore, value: string) => setReasons((current) => ({ ...current, [q.raceId]: value }));

  if (queued.length === 0 && !storageError) return <>{alwaysImport && <OutboxTransfer competitionId={competitionId} competitionName={competitionName} viaLink={viaLink} />}{toast.node}</>;

  return (
    <div className="space-y-2">
      {storageError && <Notice>{OUTBOX_STORAGE_ERROR}</Notice>}
      {conflict && (
        <Sheet
          key={scoreKey(conflict)}
          title={conflict.programmeChanged ? `${conflict.label}: programme changed` : `${conflict.label} was scored on another phone too`}
          description={conflict.programmeChanged ? "These scores belong to the earlier race programme. Keep a backup and ask the organiser to review them. They cannot be sent as results for the replacement race." : "The results don’t match. Choose which to keep."}
          onClose={() => { if (conflict.programmeChanged) keepOnPhone(conflict); }}
          dismissible={Boolean(conflict.programmeChanged)}
        >
          {({ close }) => <>
            <dl className="kit-sheet-text grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              {!conflict.programmeChanged && <><dt className="font-semibold">Theirs</dt><dd>{describePlacings(conflict.theirs ?? [], conflict.teamNames)}</dd></>}
              <dt className="font-semibold">Yours</dt><dd>{describePlacings(conflict.places, conflict.teamNames)}</dd>
            </dl>
            {conflict.programmeChanged ? <>
              <OutboxTransfer competitionId={competitionId} competitionName={competitionName} viaLink={viaLink} showImport={false} />
              {storageError && <Notice>{OUTBOX_STORAGE_ERROR}</Notice>}
              <div className="kit-acts">
                <button type="button" className="kit-pill kit-pill-fill" onClick={() => close()}>Keep on this phone</button>
                <button type="button" className="kit-redtext" onClick={async () => {
                  if (await confirmDialog({ title: 'Discard these old scores?', message: 'Keep a backup before removing scores for the earlier race programme.', confirmLabel: 'Discard old scores', destructive: true })) update((list) => discard(list, conflict.raceId));
                }}>Discard old scores</button>
              </div>
            </> : <>
              <label className="kit-sheet-field">Reason for replacing these results
                <textarea className="input" maxLength={1000} value={reasonOf(conflict)} onChange={(event) => setReason(conflict, event.target.value)} />
              </label>
              <div className="kit-acts">
                <button type="button" className="kit-pill kit-pill-fill" onClick={() => update((list) => discard(list, conflict.raceId))}>Keep theirs</button>
                <button type="button" className="kit-pill" disabled={!reasonOf(conflict).trim()} onClick={() => update((list) => overrule(list, conflict.raceId, reasonOf(conflict).trim()))}>Use mine</button>
              </div>
            </>}
          </>}
        </Sheet>
      )}
      {queued.filter((score) => score.state === 'conflict' && score.programmeChanged && keptOnPhone.has(scoreKey(score))).map((score) => (
        <Notice key={scoreKey(score)} actionLabel="Review old scores" onAction={() => setKeptOnPhone((current) => {
          const next = new Set(current); next.delete(scoreKey(score)); return next;
        })}>
          {score.label}: the programme changed. Your earlier scores are still on this phone for the organiser to review.
        </Notice>
      ))}
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
      {showWaiting.length > 0 && (
        <Notice tone="info" icon={CloudOff} actionLabel="Send now" onAction={() => void flushOutbox()}>
          {showWaiting.length === 1 ? `${showWaiting[0].label} is` : <><TickerNumber value={showWaiting.length} format={String} /> races are</>} saved on this phone and will send when you have signal.
        </Notice>
      )}
      {queued.length > 0 && <OutboxTransfer competitionId={competitionId} competitionName={competitionName} viaLink={viaLink} />}
      {toast.node}
    </div>
  );
}
