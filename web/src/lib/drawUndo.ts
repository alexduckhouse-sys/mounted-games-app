import { tr } from '../i18n/translate';
import type { DrawUndoResult, DrawUndoStatus } from '../types';

export const EMPTY_DRAW_UNDO_STATUS: DrawUndoStatus = {
  available: false,
  undoId: null,
  kind: null,
  label: null,
  sectionId: null,
  sessionId: null,
  createdAt: null,
  expiresAt: null,
  affectedHeats: 0,
  affectedSessions: 0,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Parses a `DrawUndoStatus` payload from the API, returning `EMPTY_DRAW_UNDO_STATUS` for malformed input. */
export function parseDrawUndoStatus(raw: unknown): DrawUndoStatus {
  if (!isRecord(raw) || raw.available !== true) return EMPTY_DRAW_UNDO_STATUS;
  return {
    available: true,
    undoId: typeof raw.undoId === 'number' ? raw.undoId : null,
    kind: typeof raw.kind === 'string' ? raw.kind : null,
    label: typeof raw.label === 'string' ? raw.label : null,
    sectionId: typeof raw.sectionId === 'number' ? raw.sectionId : null,
    sessionId: typeof raw.sessionId === 'number' ? raw.sessionId : null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : null,
    expiresAt: typeof raw.expiresAt === 'string' ? raw.expiresAt : null,
    affectedHeats: typeof raw.affectedHeats === 'number' && raw.affectedHeats >= 0 ? raw.affectedHeats : 0,
    affectedSessions: typeof raw.affectedSessions === 'number' && raw.affectedSessions >= 0 ? raw.affectedSessions : 0,
  };
}

/** True when an undo snapshot is available and its 30-minute window has not expired. */
export function isDrawUndoActive(status: DrawUndoStatus | null | undefined, nowMs: number = Date.now()): boolean {
  if (!status || !status.available) return false;
  if (!status.expiresAt) return true;
  const expiresMs = Date.parse(status.expiresAt);
  if (Number.isNaN(expiresMs)) return true;
  return expiresMs > nowMs;
}

/** Formats the remaining minutes in the 30-minute undo window (e.g. `"28m left"`). */
export function formatUndoWindowRemaining(status: DrawUndoStatus | null | undefined, nowMs: number = Date.now()): string {
  if (!status?.available || !status.expiresAt) return '';
  const expiresMs = Date.parse(status.expiresAt);
  if (Number.isNaN(expiresMs)) return '';
  const remainingSec = Math.max(0, Math.ceil((expiresMs - nowMs) / 1000));
  if (remainingSec <= 0) return tr('ops2.undo.expired');
  const mins = Math.ceil(remainingSec / 60);
  return tr('ops2.undo.minsLeft', { count: mins });
}

/** Human-friendly button label for the prominent Undo banner on OperationsPage and TimetablePage. */
export function drawUndoActionLabel(status: DrawUndoStatus | null | undefined): string {
  if (!status?.available) return 'Undo Last Redraw / Restore Deleted Heat';
  if (status.kind === 'DeleteHeat' || status.kind === 'ClearHeats') {
    return 'Restore Deleted Heat';
  }
  if (status.kind === 'SectionDraw' || status.kind === 'GenerateHeats' || status.kind === 'GenerateRaceFinals') {
    return 'Undo Last Redraw';
  }
  return 'Undo Last Redraw / Restore Deleted Heat';
}

/** Summary line describing what will be restored when the organiser clicks Undo. */
export function drawUndoBannerDescription(status: DrawUndoStatus | null | undefined, nowMs: number = Date.now()): string {
  if (!status?.available) return '';
  const label = status.label?.trim() || tr('ops2.undo.lastDraw');
  const heatsWord = status.affectedHeats === 1 ? tr('ops2.undo.oneHeat') : tr('ops2.undo.heats', { count: status.affectedHeats });
  const remaining = formatUndoWindowRemaining(status, nowMs);
  return remaining ? `${label} (${heatsWord} · ${remaining})` : `${label} (${heatsWord})`;
}

/** Parses the response from `POST /competitions/:id/draw-undo`. */
export function parseDrawUndoResult(raw: unknown): DrawUndoResult | null {
  if (!isRecord(raw) || raw.restored !== true) return null;
  return {
    restored: true,
    label: typeof raw.label === 'string' ? raw.label : 'Restored previous heat state',
    restoredSessions: typeof raw.restoredSessions === 'number' ? raw.restoredSessions : 0,
    restoredHeats: typeof raw.restoredHeats === 'number' ? raw.restoredHeats : 0,
    undoStatus: parseDrawUndoStatus(raw.undoStatus),
  };
}
