import type { EquipmentChecklistItem } from './types';

/** Stepping stones are laid out six to a set, so the list counts sets rather than single stones. */
export const STONES_PER_SET = 6;
const BIG = new Set(['bin', 'box', 'in / station', 'pole', 'stepping stone set']);

export interface EquipmentLine {
  /** What the row says, e.g. "6 × Stepping stone set". */
  label: string;
  name: string;
  count: number;
  /** Every checklist key the row stands for (the same kit can be needed in several parts of the arena). */
  keys: string[];
  big: boolean;
}

/** One name for the kit and its count; single stones become whole sets. */
function displayed(item: EquipmentChecklistItem): { name: string; count: number } {
  return /^stepping stones?$/i.test(item.kind.trim())
    ? { name: 'Stepping stone set', count: item.count / STONES_PER_SET }
    : { name: item.kind.trim(), count: item.count };
}

/** The checklist as a plain list: the same kit from different parts of the arena is added up into one line. */
export function equipmentLines(items: EquipmentChecklistItem[]): EquipmentLine[] {
  const merged = new Map<string, { name: string; count: number; keys: string[] }>();
  for (const item of items) {
    const { name, count } = displayed(item);
    const entry = merged.get(name.toLowerCase()) ?? { name, count: 0, keys: [] };
    entry.count += count;
    entry.keys.push(item.key);
    merged.set(name.toLowerCase(), entry);
  }
  return [...merged.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      const count = Math.ceil(entry.count);
      return { ...entry, count, label: `${count} × ${entry.name}`, big: BIG.has(entry.name.toLowerCase()) };
    });
}
