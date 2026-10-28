import { enqueue, type QueuedScore } from '../offline/scoreOutbox';
import type { PendingPlace } from './raceScoring';
import type { CardMark } from './refereeCards';

/** How many actions can be undone. */
export const UNDO_LIMIT = 10;

/** The placings on a race as they were before one action (a tap, a swipe, a reason or Clear). */
export interface DraftUndo { kind: 'draft'; raceId: number; places: PendingPlace[] }

/** A race save. `queuedBefore` is the save it replaced in the outbox, if any; `draft` is what was on screen when it was saved. */
export interface SaveUndo { kind: 'save'; raceId: number; sent: QueuedScore; queuedBefore: QueuedScore | null; draft: PendingPlace[] }

/** A card or HC change made from race tools: what the team had before, so undo can put it back. */
export type MarkChange = { type: 'card'; teamId: number; before: CardMark } | { type: 'hc'; teamId: number; before: boolean };

/** A card or HC change made while this race was open. */
export interface MarkUndo { kind: 'mark'; raceId: number; change: MarkChange }

export type UndoEntry = DraftUndo | SaveUndo | MarkUndo;

export function pushUndo(stack: UndoEntry[], entry: UndoEntry): UndoEntry[] {
  return [...stack, entry].slice(-UNDO_LIMIT);
}

/** Placings entered for a race go with its draft, so they are forgotten when the draft is. Saves stay undoable. */
export function dropDrafts(stack: UndoEntry[], raceId?: number): UndoEntry[] {
  return stack.filter((e) => e.kind === 'save' || (raceId !== undefined && e.raceId !== raceId));
}

export interface SaveUndoResult {
  outbox: QueuedScore[];
  /** What the scorer sees to carry on from. */
  restore: PendingPlace[];
  /** What happened: the save was cancelled, a correction was queued, or the race was reopened for the scorer to correct. */
  how: 'cancelled' | 'corrected' | 'reopened';
}

/**
 * Take back a race save. While it still waits in the outbox it is cancelled (the save it replaced comes back).
 * Once sent (or while it is being sent), the race's earlier results go back as a correction through the outbox. If the race had no earlier
 * results there is nothing to send back, so it is reopened with what was saved for the scorer to correct.
 */
export function undoSave(
  list: QueuedScore[], entry: SaveUndo, now: Date = new Date(), inFlight: (q: QueuedScore) => boolean = () => false,
): SaveUndoResult {
  const waiting = list.find((q) => q.raceId === entry.raceId && q.saveId === entry.sent.saveId);
  // A save already being sent may commit whatever we do, so it can't just be deleted: it is reversed after it lands.
  const sending = waiting != null && inFlight(waiting);
  if (waiting && !sending) {
    const rest = list.filter((q) => q !== waiting);
    return { outbox: entry.queuedBefore ? enqueue(rest, entry.queuedBefore) : rest, restore: entry.draft, how: 'cancelled' };
  }
  const prior = entry.sent.expected;
  if (prior.length === 0) return { outbox: list, restore: entry.draft, how: 'reopened' };
  const correction: QueuedScore = {
    ...entry.sent,
    saveId: crypto.randomUUID(),
    reason: 'Undo: reversed the last save',
    places: prior,
    // What the server holds now is what was sent. A save still in flight lands first, and settling it then updates this.
    expected: sending ? entry.sent.expected : entry.sent.places,
    queuedAt: now.toISOString(),
    state: 'waiting',
    theirs: undefined,
    error: undefined,
  };
  return { outbox: enqueue(list, correction), restore: [], how: 'corrected' };
}
