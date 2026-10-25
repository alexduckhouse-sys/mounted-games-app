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

/**
 * Real-world arena coordinates where Start/Finish = 0, Changeover (TOP) = 100,
 * and the 5 poles P1..P5 are spaced 100% evenly apart (step Δx = 22):
 * P1 = 22, P2 = 44, P3 = 66, P4 = 88 (before Changeover), P5 = 110 (beyond Changeover).
 * Equipment at the top/beyond end sits beyond the Changeover line (108..116).
 */
export const POLE_X = [22, 44, 66, 88, 110] as const;
export const POLE_LABELS = ['P1', 'P2', 'P3', 'P4', 'P5'] as const;
export const PAD_R = 130;

export const SLOT_COORDS: Record<string, { x: number; y: number }> = {
  start: { x: 0, y: 0 },
  start_left: { x: 0, y: -1 },
  start_right: { x: 0, y: 1 },
  gap0: { x: 11, y: 0 },
  pole1: { x: 22, y: 0 },
  pole1_left: { x: 22, y: -1 },
  pole1_right: { x: 22, y: 1 },
  gap1: { x: 33, y: 0 },
  mid_1_2: { x: 33, y: 0 },
  pole2: { x: 44, y: 0 },
  pole2_left: { x: 44, y: -1 },
  pole2_right: { x: 44, y: 1 },
  gap2: { x: 55, y: 0 },
  mid_2_3: { x: 55, y: 0 },
  midline: { x: 55, y: 0 },
  pole3: { x: 66, y: 0 },
  pole3_left: { x: 66, y: -1 },
  pole3_right: { x: 66, y: 1 },
  gap3: { x: 77, y: 0 },
  mid_3_4: { x: 77, y: 0 },
  pole4: { x: 88, y: 0 },
  pole4_left: { x: 88, y: -1 },
  pole4_right: { x: 88, y: 1 },
  gap4: { x: 94, y: 0 },
  mid_4_top: { x: 94, y: 0 },
  changeover: { x: 100, y: 0 },
  gap5: { x: 104, y: 0 },
  top: { x: 108, y: 0 },
  top_left: { x: 108, y: -1 },
  top_right: { x: 108, y: 1 },
  pole5: { x: 110, y: 0 },
  pole5_left: { x: 110, y: -1 },
  pole5_right: { x: 110, y: 1 },
  beyond: { x: 116, y: 0 },
  beyond_left: { x: 116, y: -1 },
  beyond_right: { x: 116, y: 1 },
};

const CANONICAL_SLOTS = ['start', 'gap0', 'pole1', 'gap1', 'pole2', 'gap2', 'pole3', 'gap3', 'pole4', 'gap4', 'top', 'pole5', 'beyond'] as const;

export function inferCanonicalSlot(pos: DiagramPos & { t?: string }): string {
  const isPole = pos.t === 'pole';
  const rawAnchor = pos.anchor?.trim().toLowerCase();
  if (rawAnchor && !pos.offset) {
    const base = rawAnchor.replace(/_(left|right)$/, '');
    if (base === 'finish') return 'top';
    if (base === 'mid_1_2') return 'gap1';
    if (base === 'mid_2_3' || base === 'midline') return isPole ? 'pole3' : 'gap2';
    if (base === 'mid_3_4') return 'gap3';
    if (base === 'mid_4_top' || base === 'changeover') return isPole ? 'pole5' : 'gap4';
    if (base in SLOT_COORDS && (!isPole || base.startsWith('pole'))) return base;
  }
  const x = typeof pos.x === 'number' ? pos.x : 55;
  if (isPole) {
    const poleCandidates: [string, number[]][] = [
      ['pole1', [17, 18, 22]],
      ['pole2', [33, 34, 36, 39, 44]],
      ['pole3', [50, 55, 61, 66]],
      ['pole4', [67, 73, 83, 88]],
      ['pole5', [91, 110]],
    ];
    let bestPole = 'pole1';
    let bestDist = Infinity;
    for (const [id, xs] of poleCandidates) {
      for (const px of xs) {
        const d = Math.abs(x - px);
        if (d < bestDist) { bestDist = d; bestPole = id; }
      }
    }
    return bestPole;
  }
  if (Math.abs(x - 0) <= 5) return 'start';
  if (Math.abs(x - 11) <= 4) return 'gap0';
  if (Math.abs(x - 17) <= 2 || Math.abs(x - 18) <= 2 || Math.abs(x - 22) <= 3) return 'pole1';
  if (Math.abs(x - 33) <= 3) return 'gap1';
  if (Math.abs(x - 36) <= 2 || Math.abs(x - 39) <= 2 || Math.abs(x - 44) <= 3) return 'pole2';
  if (Math.abs(x - 50) <= 3 || Math.abs(x - 55) <= 3) return 'gap2';
  if (Math.abs(x - 61) <= 2 || Math.abs(x - 66) <= 3) return 'pole3';
  if (Math.abs(x - 77) <= 3) return 'gap3';
  if (Math.abs(x - 91) <= 2) return 'pole5';
  if (Math.abs(x - 73) <= 2 || Math.abs(x - 83) <= 2 || Math.abs(x - 88) <= 2) return 'pole4';
  if (Math.abs(x - 94) <= 1) return 'gap4';
  if (Math.abs(x - 96) <= 2 || x >= 112) return 'beyond';
  if (x >= 99 && x <= 109) return 'top';
  if (Math.abs(x - 110) <= 2) return 'pole5';
  return snapToSlot(x, false).slot;
}

export function snapToSlot(x: number, isPole = false): { slot: string; x: number } {
  const candidates = isPole ? ['pole1', 'pole2', 'pole3', 'pole4', 'pole5'] : CANONICAL_SLOTS;
  let best: string = candidates[0];
  let bestDist = Infinity;
  for (const id of candidates) {
    const coord = SLOT_COORDS[id];
    const d = Math.abs(coord.x - x);
    if (d < bestDist) {
      bestDist = d;
      best = id;
    }
  }
  return { slot: best, x: SLOT_COORDS[best].x };
}

export function normalisePlacement(el: DiagramElement): DiagramElement {
  if (el.t === 'midline' || el.t === 'lane') return el;
  const pos = el as DiagramPos & { t: string };
  const slot = inferCanonicalSlot(pos);
  const coord = SLOT_COORDS[slot] ?? SLOT_COORDS.start;
  const copy = { ...pos };
  delete copy.offset;
  return { ...copy, anchor: slot, x: coord.x } as DiagramElement;
}

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
  const positioned = elements.filter(isPositioned);
  if (positioned.some((e) => {
    const pos = e as DiagramPos;
    return pos.anchor?.toLowerCase() === 'pole5'
      || (e.t === 'pole' && typeof pos.x === 'number' && ((pos.x >= 89 && pos.x <= 93) || pos.x >= 109));
  })) {
    return 5;
  }
  const xs = positioned.map((e) => resolveX(e, elements));
  if (xs.length > 0 && xs.every((x) => [22, 44, 66, 88].some((px) => Math.abs(x - px) <= 1.5))) {
    return 4;
  }
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
  const hasFifthPoleCoord = poleCount === 5 && elements.some(
    (e) => e.t === 'pole' && typeof e.x === 'number' && ((e.x >= 89 && e.x <= 93) || e.x >= 109),
  );
  const hasEvenPoleCoord = elements.some(
    (e) => e.t === 'pole' && typeof e.x === 'number' && (Math.abs(e.x - 22) <= 1.5 || Math.abs(e.x - 110) <= 2),
  );
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
    if (!slot && (hasFifthPoleCoord || hasEvenPoleCoord) && typeof pos.x === 'number') {
      const idx = [17, 39, 61, 83, 91].findIndex((px) => Math.abs(pos.x! - px) <= 2);
      const evenIdx = [22, 44, 66, 88, 110].findIndex((px) => Math.abs(pos.x! - px) <= 1.5);
      if (evenIdx >= 0) slot = slotById(slots, `pole${evenIdx + 1}`);
      else if (idx >= 0) slot = slotById(slots, `pole${idx + 1}`);
      else if ((Math.abs(pos.x - 50) <= 2 || Math.abs(pos.x - 55) <= 2) && !kinds) slot = slotById(slots, 'gap2');
      else if (Math.abs(pos.x - 108) <= 1 && !kinds) slot = slotById(slots, 'top');
      else if (pos.x >= 114 && !kinds) slot = slotById(slots, 'beyond');
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
    if (!have.has(`pole${k}`)) add.push({ el: { t: 'pole' }, slot: `pole${k}` });
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
