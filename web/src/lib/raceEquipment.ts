import { DIAGRAM_TOOLS, type DiagramElement } from '../types';

export interface EquipmentCount { label: string; count: number }

function parse(json?: string | null): DiagramElement[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e): e is DiagramElement => !!e && typeof e === 'object' && typeof (e as { t?: unknown }).t === 'string');
  } catch { return []; }
}

function labelFor(el: DiagramElement): string | null {
  if (el.t === 'midline') return null;
  const own = typeof el.label === 'string' ? el.label.trim() : '';
  if (own) return own;
  // `table` is the legacy name for `in`.
  const t = el.t === 'table' ? 'in' : el.t;
  return DIAGRAM_TOOLS.find((tool) => tool.t === t && tool.kind === el.kind)?.label
    ?? DIAGRAM_TOOLS.find((tool) => tool.t === t && !tool.kind)?.label
    ?? (t === 'item' || t === 'cone' ? 'Item' : null);
}

/** Counts the equipment a race's set-up diagram uses, including things stacked on other things. */
export function equipmentFromDiagram(json?: string | null): EquipmentCount[] {
  const counts = new Map<string, EquipmentCount>();
  const add = (el: DiagramElement) => {
    const label = labelFor(el);
    if (label) {
      const key = label.toLowerCase();
      const found = counts.get(key);
      if (found) found.count += 1;
      else counts.set(key, { label, count: 1 });
    }
    if (el.t !== 'midline') for (const stacked of Array.isArray(el.on) ? el.on : []) if (stacked && typeof stacked === 'object') add(stacked);
  };
  for (const el of parse(json)) add(el);
  return [...counts.values()];
}
