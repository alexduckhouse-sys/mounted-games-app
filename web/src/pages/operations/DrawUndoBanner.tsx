import { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Notice } from '../../components/Notice';
import { useToast } from '../../components/Toast';
import { useNow } from '../../hooks/useNow';
import { useDrawUndo } from '../../hooks/useDrawUndo';
import { apiErrorMessage } from '../../lib/apiError';
import { drawUndoBannerDescription, isDrawUndoActive } from '../../lib/drawUndo';
import type { DrawUndoStatus } from '../../types';

/** The button for what the snapshot holds. The shared helper's labels are in title case, so the wording lives here. */
function undoButtonLabel(status: DrawUndoStatus): string {
  return status.kind === 'DeleteHeat' || status.kind === 'ClearHeats' ? 'Restore the heats' : 'Undo the draw';
}

/**
 * For 30 minutes after a draw is applied, or heats are deleted or regenerated, the organiser can put it back.
 * Bump `version` after any of those so the banner looks again. It asks before it does anything.
 */
export function DrawUndoBanner({ competitionId, version = 0, onRestored }: { competitionId: number; version?: number; onRestored?: () => void }) {
  const { undoStatus, restoring, refresh, undo } = useDrawUndo(competitionId);
  const now = useNow(30_000);
  const toast = useToast();
  const [problem, setProblem] = useState<string | null>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    void refresh();
  }, [version, refresh]);

  if (!isDrawUndoActive(undoStatus, now.getTime())) return toast.node;

  async function restore() {
    const status = undoStatus;
    const ok = await confirmDialog({
      title: `${undoButtonLabel(status)}?`,
      message: 'Lanes and heats go back to how they were before. It only works while no race in those heats has been scored. Anyone watching sees the change straight away.',
      confirmLabel: undoButtonLabel(status),
    });
    if (!ok) return;
    setProblem(null);
    try {
      const result = await undo();
      toast.show(result ? 'Draw put back' : 'Nothing to put back');
      onRestored?.();
    } catch (caught) {
      setProblem(apiErrorMessage(caught, 'Couldn’t put the draw back. Check your signal and try again.'));
    }
  }

  return (
    <>
      {toast.node}
      <Notice tone="info" icon={RotateCcw} actionLabel={restoring ? 'Working…' : undoButtonLabel(undoStatus)} onAction={() => void restore()} actionDisabled={restoring}>
        Last change: {drawUndoBannerDescription(undoStatus, now.getTime())}
      </Notice>
      {problem && <Notice>{problem}</Notice>}
    </>
  );
}
