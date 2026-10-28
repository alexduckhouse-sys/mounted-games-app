import { tr } from '../../i18n/translate';
import { useT } from '../../i18n/LanguageContext';
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
  return status.kind === 'DeleteHeat' || status.kind === 'ClearHeats' ? tr('ops2.undo.restoreHeats') : tr('ops2.undo.undoDraw');
}

/**
 * For 30 minutes after a draw is applied, or heats are deleted or regenerated, the organiser can put it back.
 * Bump `version` after any of those so the banner looks again. It asks before it does anything.
 */
export function DrawUndoBanner({ competitionId, version = 0, onRestored }: { competitionId: number; version?: number; onRestored?: () => void }) {
  const { undoStatus, restoring, refresh, undo } = useDrawUndo(competitionId);
  const now = useNow(30_000);
  const toast = useToast();
  const t = useT();
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
      message: t('ops2.undo.message'),
      confirmLabel: undoButtonLabel(status),
    });
    if (!ok) return;
    setProblem(null);
    try {
      const result = await undo();
      toast.show(result ? t('ops2.undo.putBack') : t('ops2.undo.nothing'));
      onRestored?.();
    } catch (caught) {
      setProblem(apiErrorMessage(caught, t('ops2.undo.putBackError')));
    }
  }

  return (
    <>
      {toast.node}
      <Notice tone="info" icon={RotateCcw} actionLabel={restoring ? t('ops2.undo.working') : undoButtonLabel(undoStatus)} onAction={() => void restore()} actionDisabled={restoring}>
        {t('ops2.undo.lastChange', { text: drawUndoBannerDescription(undoStatus, now.getTime()) })}
      </Notice>
      {problem && <Notice>{problem}</Notice>}
    </>
  );
}
