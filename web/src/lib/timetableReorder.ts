import { moveItem } from './creatorRaces';

/** One block in an arena's running order, as far as re-timing it is concerned. */
export interface SlotItem {
  id: number;
  start: Date | null;
  minutes: number;
  /** Keeps its own time: started or drawn sessions, finals (they have a start the organiser sets) and anything with no start yet. */
  fixed: boolean;
}

const MINUTE = 60_000;

/**
 * The new start times when the block at `from` is dragged to `to`. Blocks that keep their own time stay put; the rest
 * are shared out among the same places in the new order, each starting when the one before ends plus whatever gap that
 * place had. Only blocks whose start changes are returned.
 */
export function reorderStarts(list: readonly SlotItem[], from: number, to: number): { id: number; start: Date }[] {
  if (from === to || !list[from] || list[from].fixed || to < 0 || to >= list.length) return [];
  const order = moveItem(list, from, to).filter((item) => !item.fixed);
  let next = 0;
  const sequence = list.map((slot) => (slot.fixed ? slot : order[next++]));
  const ends: (Date | null)[] = [];
  const changes: { id: number; start: Date }[] = [];
  sequence.forEach((item, q) => {
    let start = item.start;
    if (!item.fixed && item.start) {
      const slot = list[q];
      const before = q > 0 ? ends[q - 1] : null;
      const previous = q > 0 ? list[q - 1] : null;
      if (q === 0 || !before) start = slot.start ?? item.start;
      else {
        const slotGap = previous?.start && slot.start ? Math.max(0, Math.round((slot.start.getTime() - previous.start.getTime()) / MINUTE - previous.minutes)) : 0;
        start = new Date(before.getTime() + slotGap * MINUTE);
      }
      if (start.getTime() !== item.start.getTime()) changes.push({ id: item.id, start });
    }
    ends[q] = start ? new Date(start.getTime() + item.minutes * MINUTE) : null;
  });
  return changes;
}
