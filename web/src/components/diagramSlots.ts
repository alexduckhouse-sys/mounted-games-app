import type { ConeKind, DiagramElement, DiagramPos, DiagramTool, ItemKind } from '../types';
import { DIAGRAM_TOOLS } from '../types';
import { clampPct, resolveX } from './diagramGeometry';

/**
 * Pole-based lane model.
 *
 * A lane has a START line (x = 0), N bending poles evenly spaced between
 * POLE_FIRST_X and POLE_LAST_X, the TOP / changeover line (x = 100) and a
 * zone BEYOND the top line. Equipment can only sit in a *slot*: on a pole,
 * in a gap between two neighbouring poles (or between the start line and
 * pole 1, or between the last pole and the top line), on the start or top
 * line, or beyond the top line. Each slot has a fixed x, so the numeric `x`
 * stored in the JSON is always derived from the slot.
 *
 * Slot ids are stored in the existing `anchor` field so the JSON stays
 * compatible: `start`, `gap0`, `pole1`, `gap1`, `pole2`, ... `poleN`,
 * `gapN`, `top`, `beyond`. `gapK` is the gap after pole K (gap0 is the gap
 * before pole 1). The pole count is stored as `{ "t": "lane", "poles": N }`.
 */
export type SlotKind = 'start' | 'pole' | 'gap' | 'top' | 'beyond';

export interface Slot {
  id: string;
  kind: SlotKind;
  /** Pole number for `pole`; for `gap`, the pole before the gap (0 = start line). */
  index: number;
  x: number;
  /** Short label for chips, e.g. "Pole 2" or "1–2". */
  label: string;
  /** Long label for screen readers and headings. */
  description: string;
}

export const STANDARD_POLE_COUNT = 5;
export const MIN_POLES = 2;
export const MAX_POLES = 8;
export const POLE_FIRST_X = 17;
export const POLE_LAST_X = 83;
export const TOP_X = 100;
export const BEYOND_X = 112;

type Positioned = Exclude<DiagramElement, { t: 'midline' } | { t: 'lane' }>;

export function clampPoleCount(n: number): number {
  if (!Number.isFinite(n)) return STANDARD_POLE_COUNT;
  return Math.max(MIN_POLES, Math.min(MAX_POLES, Math.round(n)));
}

export function poleX(index: number, poleCount: number): number {
  const n = clampPoleCount(poleCount);
  return POLE_FIRST_X + ((index - 1) * (POLE_LAST_X - POLE_FIRST_X)) / (n - 1);
}

/** All slots for a lane with `poleCount` poles, in order from the start line outwards. */
export function buildSlots(poleCount: number): Slot[] {
  const n = clampPoleCount(poleCount);
  const slots: Slot[] = [
    { id: 'start', kind: 'start', index: 0, x: 0, label: 'Start', description: 'On the start line' },
  ];
  for (let k = 0; k <= n; k++) {
    const left = k === 0 ? 0 : poleX(k, n);
    const right = k === n ? TOP_X : poleX(k + 1, n);
    const from = k === 0 ? 'the start line' : `pole ${k}`;
    const to = k === n ? 'the top line' : `pole ${k + 1}`;
    slots.push({
      id: `gap${k}`, kind: 'gap', index: k, x: (left + right) / 2,
      label: `${k === 0 ? 'Start' : k}–${k === n ? 'Top' : k + 1}`,
      description: `Between ${from} and ${to}`,
    });
    if (k < n) {
      slots.push({ id: `pole${k + 1}`, kind: 'pole', index: k + 1, x: poleX(k + 1, n), label: `Pole ${k + 1}`, description: `On pole ${k + 1}` });
    }
  }
  slots.push({ id: 'top', kind: 'top', index: n + 1, x: TOP_X, label: 'Top', description: 'On the top line' });
  slots.push({ id: 'beyond', kind: 'beyond', index: n + 2, x: BEYOND_X, label: 'Beyond', description: 'Beyond the top line' });
  return slots;
}

export function slotById(slots: Slot[], id: string | undefined): Slot | undefined {
  return id ? slots.find((s) => s.id === id) : undefined;
}

/** The slot whose x is closest to `x`, optionally limited to some kinds. */
export function nearestSlot(slots: Slot[], x: number, kinds?: SlotKind[]): Slot {
  const pool = kinds ? slots.filter((s) => kinds.includes(s.kind)) : slots;
  const list = pool.length ? pool : slots;
  let best = list[0];
  for (const s of list) if (Math.abs(s.x - x) < Math.abs(best.x - x)) best = s;
  return best;
}

/** Poles can only stand on pole slots. */
export function allowedSlotKinds(el: DiagramElement): SlotKind[] | undefined {
  return el.t === 'pole' ? ['pole'] : undefined;
}

// --- model ------------------------------------------------------------------

export interface LaneElement {
  el: Positioned;
  slot: string;
}

export interface LaneModel {
  poleCount: number;
  midline: boolean;
  items: LaneElement[];
}

export function parseDiagram(json?: string | null): DiagramElement[] {
  if (!json) return [];
  try {
    const arr: unknown = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.filter((e): e is DiagramElement => !!e && typeof e === 'object' && typeof (e as { t?: unknown }).t === 'string');
  } catch {
    return [];
  }
}

function isPositioned(e: DiagramElement): e is Positioned {
  return e.t !== 'midline' && e.t !== 'lane';
}

/**
 * Best pole count for a diagram that does not say. Counts how many positioned
 * elements land exactly on a pole position for each candidate layout; ties go
 * to the standard five poles.
 */
export function inferPoleCount(elements: DiagramElement[]): number {
  const xs = elements.filter(isPositioned).map((e) => resolveX(e, elements));
  let best = STANDARD_POLE_COUNT;
  let bestScore = -1;
  for (const n of [STANDARD_POLE_COUNT, 4, 3, 6, 2, 7, 8]) {
    let score = 0;
    for (const x of xs) {
      for (let k = 1; k <= n; k++) if (Math.abs(poleX(k, n) - x) <= 1.5) { score++; break; }
    }
    if (score > bestScore) { best = n; bestScore = score; }
  }
  return best;
}

/**
 * Reads any stored diagram (old free x, anchor + offset, or the slot shape)
 * into the lane model. Old positions map to the nearest slot.
 */
export function toLaneModel(elements: DiagramElement[]): LaneModel {
  const lane = elements.find((e): e is { t: 'lane'; poles?: number } => e.t === 'lane');
  const poleCount = lane && typeof lane.poles === 'number' ? clampPoleCount(lane.poles) : inferPoleCount(elements);
  const slots = buildSlots(poleCount);
  const items: LaneElement[] = [];
  for (const raw of elements) {
    if (!isPositioned(raw)) continue;
    const pos = raw as DiagramPos;
    const kinds = allowedSlotKinds(raw);
    let slot: Slot | undefined;
    if (pos.anchor && !pos.offset) {
      const named = slotById(slots, pos.anchor.toLowerCase());
      if (named && (!kinds || kinds.includes(named.kind))) slot = named;
      else if (pos.anchor.toLowerCase() === 'finish') slot = slotById(slots, 'top');
      else if (pos.anchor.toLowerCase() === 'changeover' && !kinds) slot = slotById(slots, `gap${poleCount}`);
    }
    slot ??= nearestSlot(slots, resolveX(pos, elements), kinds);
    const el = { ...raw, ...(pos.on ? { on: sanitiseOn(pos.on) } : {}) } as Positioned;
    items.push({ el, slot: slot.id });
  }
  return { poleCount, midline: elements.some((e) => e.t === 'midline'), items };
}

function sanitiseOn(on: unknown): DiagramElement[] {
  return Array.isArray(on)
    ? on.filter((c): c is DiagramElement => !!c && typeof c === 'object' && isPositioned(c as DiagramElement) && typeof (c as { t?: unknown }).t === 'string')
    : [];
}

/** Writes the lane model in the slot shape: `anchor` is the slot, `x` is derived. */
export function fromLaneModel(model: LaneModel): DiagramElement[] {
  const slots = buildSlots(model.poleCount);
  const out: DiagramElement[] = [{ t: 'lane', poles: model.poleCount }];
  for (const { el, slot } of model.items) {
    const s = slotById(slots, slot) ?? slots[0];
    const copy = { ...el } as DiagramPos & { t: string };
    delete copy.offset;
    out.push({ ...copy, anchor: s.id, x: Math.round(s.x * 10) / 10 } as DiagramElement);
  }
  if (model.midline) out.push({ t: 'midline' });
  return out;
}

/** Resolved layout used by the renderer: each element with its slot and x. */
export interface PlacedElement { el: Positioned; slot: Slot; x: number; index: number }

export function placeElements(model: LaneModel): { slots: Slot[]; placed: PlacedElement[] } {
  const slots = buildSlots(model.poleCount);
  const placed = model.items.map((it, index) => {
    const slot = slotById(slots, it.slot) ?? slots[0];
    return { el: it.el, slot, x: clampPct(slot.x), index };
  });
  return { slots, placed };
}

// --- editing helpers --------------------------------------------------------

export function moveToSlot(model: LaneModel, index: number, slotId: string): LaneModel {
  const item = model.items[index];
  if (!item) return model;
  const slot = slotById(buildSlots(model.poleCount), slotId);
  if (!slot) return model;
  const kinds = allowedSlotKinds(item.el);
  if (kinds && !kinds.includes(slot.kind)) return model;
  return { ...model, items: model.items.map((it, i) => (i === index ? { ...it, slot: slot.id } : it)) };
}

/** The neighbouring slot an element may move to (poles only hop between poles). */
export function stepSlot(model: LaneModel, index: number, direction: -1 | 1): string | null {
  const item = model.items[index];
  if (!item) return null;
  const slots = buildSlots(model.poleCount);
  const kinds = allowedSlotKinds(item.el);
  const list = kinds ? slots.filter((s) => kinds.includes(s.kind)) : slots;
  const at = list.findIndex((s) => s.id === item.slot);
  const next = list[at + direction];
  return next ? next.id : null;
}

export function toolToElement(tool: DiagramTool): Positioned {
  return (tool.kind ? { t: tool.t, kind: tool.kind } : { t: tool.t }) as Positioned;
}

export function placeTool(model: LaneModel, tool: DiagramTool, slotId: string): LaneModel {
  const slot = slotById(buildSlots(model.poleCount), slotId);
  if (!slot) return model;
  const el = toolToElement(tool);
  const kinds = allowedSlotKinds(el);
  if (kinds && !kinds.includes(slot.kind)) return model;
  return { ...model, items: [...model.items, { el, slot: slot.id }] };
}

export function removeItem(model: LaneModel, index: number): LaneModel {
  return { ...model, items: model.items.filter((_, i) => i !== index) };
}

export function duplicateItem(model: LaneModel, index: number): LaneModel {
  const item = model.items[index];
  if (!item) return model;
  const copy: LaneElement = { slot: item.slot, el: JSON.parse(JSON.stringify(item.el)) as Positioned };
  const items = [...model.items];
  items.splice(index + 1, 0, copy);
  return { ...model, items };
}

export function patchItem(model: LaneModel, index: number, patch: Partial<DiagramPos>): LaneModel {
  return { ...model, items: model.items.map((it, i) => (i === index ? { ...it, el: { ...it.el, ...patch } as Positioned } : it)) };
}

/** Changing the pole count re-spaces the grid; elements on slots that no longer exist move to the last matching one. */
export function setPoleCount(model: LaneModel, count: number): LaneModel {
  const poleCount = clampPoleCount(count);
  const slots = buildSlots(poleCount);
  const items = model.items.map((it) => {
    if (slotById(slots, it.slot)) return it;
    const m = /^(pole|gap)(\d+)$/.exec(it.slot);
    return m ? { ...it, slot: m[1] === 'pole' ? `pole${poleCount}` : `gap${poleCount}` } : it;
  });
  return { ...model, poleCount, items };
}

/** Puts a pole on every pole slot that has none. */
export function fillPoles(model: LaneModel): LaneModel {
  const have = new Set(model.items.filter((i) => i.el.t === 'pole').map((i) => i.slot));
  const add: LaneElement[] = [];
  for (let k = 1; k <= model.poleCount; k++) {
    if (!have.has(`pole${k}`)) add.push({ el: { t: 'pole', label: String(k) }, slot: `pole${k}` });
  }
  return { ...model, items: [...model.items, ...add] };
}

// --- contents ("what's on it") ---------------------------------------------

const CONTAINER_ITEM_KINDS: ItemKind[] = ['bin', 'bucket', 'box', 'sack', 'mug'];

export function isContainer(el: DiagramElement): boolean {
  if (!isPositioned(el)) return false;
  if (el.t === 'item') return CONTAINER_ITEM_KINDS.includes((el as DiagramPos).kind as ItemKind);
  return true; // pole, cone, in, table
}

export function toolLabel(el: DiagramElement): string {
  if (el.t === 'midline') return 'Midline';
  if (el.t === 'lane') return 'Lane';
  const t = el.t === 'table' ? 'in' : el.t;
  const kind = (el as DiagramPos).kind as ConeKind | ItemKind | undefined;
  return DIAGRAM_TOOLS.find((d) => d.t === t && d.kind === kind)?.label
    ?? DIAGRAM_TOOLS.find((d) => d.t === t && !d.kind)?.label
    ?? (t === 'item' || t === 'cone' ? 'Item' : t);
}

export interface ContentsCount { key: string; label: string; count: number; tool: DiagramTool }

function contentKey(el: Positioned): string {
  return `${el.t === 'table' ? 'in' : el.t}:${(el as DiagramPos).kind ?? ''}`;
}

/** Groups what sits on an element: [{ label: 'Mug', count: 2 }]. */
export function contentsOf(el: DiagramElement): ContentsCount[] {
  const on = isPositioned(el) ? ((el as DiagramPos).on ?? []) : [];
  const map = new Map<string, ContentsCount>();
  for (const child of on) {
    if (!isPositioned(child)) continue;
    const key = contentKey(child);
    const found = map.get(key);
    if (found) found.count++;
    else {
      const label = toolLabel(child);
      const t = child.t === 'table' ? 'in' : child.t;
      map.set(key, { key, label, count: 1, tool: { t, kind: (child as DiagramPos).kind, label } as DiagramTool });
    }
  }
  return [...map.values()];
}

/** "2 mugs", "1 ball and 2 flags". */
export function contentsSummary(el: DiagramElement): string {
  const parts = contentsOf(el).map((c) => {
    const name = c.label.toLowerCase();
    return `${c.count} ${c.count > 1 && !name.endsWith('s') ? `${name}s` : name}`;
  });
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export function addContent(model: LaneModel, index: number, tool: DiagramTool): LaneModel {
  const item = model.items[index];
  if (!item || !isContainer(item.el) || tool.t === 'pole') return model;
  return patchItem(model, index, { on: [...((item.el as DiagramPos).on ?? []), toolToElement(tool)] });
}

/** Removes one of the named kind (the most recently added). */
export function removeContent(model: LaneModel, index: number, key: string): LaneModel {
  const item = model.items[index];
  if (!item) return model;
  const on = [...((item.el as DiagramPos).on ?? [])];
  for (let i = on.length - 1; i >= 0; i--) {
    const c = on[i];
    if (isPositioned(c) && contentKey(c) === key) { on.splice(i, 1); break; }
  }
  return patchItem(model, index, { on });
}
