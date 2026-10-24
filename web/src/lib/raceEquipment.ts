import { DIAGRAM_TOOLS, type DiagramElement, type DiagramPos } from '../types';

export interface EquipmentCount { label: string; count: number }

export type PoleAction =
  | 'keep-4'
  | 'add-5th'
  | 'remove-5th'
  | 'keep-5'
  | 'set-4'
  | 'set-5'
  | 'clear-poles'
  | 'no-poles';

export type ChangeoverZone = 'Start / Changeover' | 'Poles P1–P5' | '2m Beyond / Top';

export interface ChangeoverItem {
  label: string;
  count: number;
  zone: ChangeoverZone;
}

export interface RaceChangeoverDiff {
  poleAction: PoleAction;
  poleLabel: string;
  prevPoles: number;
  nextPoles: number;
  removeItems: ChangeoverItem[];
  addItems: ChangeoverItem[];
}

const POSITIONAL_LABEL_RE = /^(?:p?\d+|pole\s*\d+|cone\s*\d+|\d+(?:st|nd|rd|th)(?:\s*(?:pole|cone))?)$/i;

function parse(json?: string | null): DiagramElement[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e): e is DiagramElement => !!e && typeof e === 'object' && typeof (e as { t?: unknown }).t === 'string');
  } catch { return []; }
}

function labelFor(el: DiagramElement): string | null {
  if (el.t === 'midline' || el.t === 'lane') return null;
  const own = typeof el.label === 'string' ? el.label.trim() : '';
  const isPositional = (el.t === 'pole' || el.t === 'cone') && POSITIONAL_LABEL_RE.test(own);
  if (own && !isPositional) return own;
  // `table` is the legacy name for `in`.
  const t = el.t === 'table' ? 'in' : el.t;
  return DIAGRAM_TOOLS.find((tool) => tool.t === t && tool.kind === el.kind)?.label
    ?? DIAGRAM_TOOLS.find((tool) => tool.t === t && !tool.kind)?.label
    ?? (t === 'item' || t === 'cone' ? 'Item' : null);
}

function classifyZone(el: DiagramElement): ChangeoverZone {
  const pos = el as DiagramPos;
  const anchor = typeof pos.anchor === 'string' ? pos.anchor.trim().toLowerCase() : '';
  const x = typeof pos.x === 'number' ? pos.x : undefined;
  if (anchor === 'start' || anchor === 'gap0') return 'Start / Changeover';
  if (anchor === 'beyond' || anchor === 'top' || anchor === 'finish' || anchor === 'changeover') return '2m Beyond / Top';
  if (anchor.startsWith('pole') || anchor === 'midline') return 'Poles P1–P5';
  if (x !== undefined && x < 12) return 'Start / Changeover';
  if (x !== undefined && x >= 88) return '2m Beyond / Top';
  return 'Poles P1–P5';
}

function walkStack(root: DiagramElement): DiagramElement[] {
  const result: DiagramElement[] = [];
  const queue: DiagramElement[] = [root];
  let cur = queue.shift();
  while (cur) {
    if (cur.t !== 'midline' && cur.t !== 'lane') {
      result.push(cur);
      if (Array.isArray(cur.on)) {
        const children = cur.on.filter(
          (s): s is DiagramElement => !!s && typeof s === 'object' && typeof (s as { t?: unknown }).t === 'string',
        );
        queue.unshift(...children);
      }
    }
    cur = queue.shift();
  }
  return result;
}

/** Counts the equipment a race's set-up diagram uses, including things stacked on other things. */
export function equipmentFromDiagram(json?: string | null): EquipmentCount[] {
  const counts = new Map<string, EquipmentCount>();
  for (const root of parse(json)) {
    for (const cur of walkStack(root)) {
      const label = labelFor(cur);
      if (!label) continue;
      const key = label.toLowerCase();
      const found = counts.get(key);
      if (found) found.count += 1;
      else counts.set(key, { label, count: 1 });
    }
  }
  return [...counts.values()];
}

function extractLaneSetup(json?: string | null): { poles: number; props: Map<string, ChangeoverItem> } {
  let poles = 0;
  const props = new Map<string, ChangeoverItem>();
  for (const root of parse(json)) {
    const zone = classifyZone(root);
    for (const cur of walkStack(root)) {
      if (cur.t === 'pole') {
        poles += 1;
        continue;
      }
      const label = labelFor(cur);
      if (!label) continue;
      const key = `${label.toLowerCase()}|${zone}`;
      const found = props.get(key);
      if (found) found.count += 1;
      else props.set(key, { label, count: 1, zone });
    }
  }
  return { poles, props };
}

function resolvePoleAction(prevPoles: number, nextPoles: number): { poleAction: PoleAction; poleLabel: string } {
  if (nextPoles === 0) {
    return prevPoles > 0
      ? { poleAction: 'clear-poles', poleLabel: 'Clear bending poles from lane' }
      : { poleAction: 'no-poles', poleLabel: 'No bending poles in lane' };
  }
  if (prevPoles === 0) {
    return nextPoles >= 5
      ? { poleAction: 'set-5', poleLabel: 'Set out 5 poles (P1–P5)' }
      : { poleAction: 'set-4', poleLabel: 'Set out 4 poles (P1–P4)' };
  }
  if (prevPoles >= 5 && nextPoles >= 5) {
    return { poleAction: 'keep-5', poleLabel: 'All 5 poles stay out' };
  }
  if (prevPoles >= 5 && nextPoles <= 4) {
    return { poleAction: 'remove-5th', poleLabel: 'Remove 5th pole (P5) · 4 poles stay out' };
  }
  if (prevPoles <= 4 && nextPoles >= 5) {
    return { poleAction: 'add-5th', poleLabel: '4 poles stay out · Bring in 5th pole (P5)' };
  }
  return { poleAction: 'keep-4', poleLabel: '4 poles stay out' };
}

/** Computes the ring-crew changeover between the previous race and the next race per lane. */
export function diffRaceEquipment(
  prevDiagramJson: string | null | undefined,
  nextDiagramJson: string | null | undefined,
): RaceChangeoverDiff {
  const prev = extractLaneSetup(prevDiagramJson);
  const next = extractLaneSetup(nextDiagramJson);
  const { poleAction, poleLabel } = resolvePoleAction(prev.poles, next.poles);

  const removeItems: ChangeoverItem[] = [];
  const addItems: ChangeoverItem[] = [];

  for (const [key, prevItem] of prev.props) {
    const nextItem = next.props.get(key);
    const nextCount = nextItem ? nextItem.count : 0;
    if (prevItem.count > nextCount) {
      removeItems.push({ label: prevItem.label, count: prevItem.count - nextCount, zone: prevItem.zone });
    }
  }

  for (const [key, nextItem] of next.props) {
    const prevItem = prev.props.get(key);
    const prevCount = prevItem ? prevItem.count : 0;
    if (nextItem.count > prevCount) {
      addItems.push({ label: nextItem.label, count: nextItem.count - prevCount, zone: nextItem.zone });
    }
  }

  return {
    poleAction,
    poleLabel,
    prevPoles: prev.poles,
    nextPoles: next.poles,
    removeItems,
    addItems,
  };
}
