import type { DiagramElement, DiagramPos } from '../types';

/**
 * Lane geometry shared by renderer + editor. The lane proper runs from the
 * START line (left) to the TOP line (right). Past x=100% there's a "behind top"
 * zone (extending to xMax) where equipment placed beyond the top line lives.
 */
export const LANE = {
  left: 80, top: 60, bottom: 180, topLineX: 660,
  beyondRight: 770,         // right boundary of the behind-top zone
  xMax: 120,                // max percentage we render (0 = start, 100 = top, 120 = ~3m beyond)
} as const;

export function pctToPx(p: number): number {
  // Linear mapping: x=0 → LANE.left, x=100 → LANE.topLineX, x>100 extrapolates.
  const span = LANE.topLineX - LANE.left;
  return LANE.left + (p / 100) * span;
}
export function pxToPct(x: number): number {
  const span = LANE.topLineX - LANE.left;
  return ((x - LANE.left) / span) * 100;
}
export function clampPct(n: number): number {
  return Math.max(0, Math.min(LANE.xMax, n));
}
export const CENTRE_Y = (LANE.top + LANE.bottom) / 2;

/**
 * Resolve an element's position along the lane (0..xMax) using either the
 * absolute `x` or a named anchor with optional offset.
 *   `pole<N>` → x of the Nth pole in the elements array (1-indexed)
 *   `start` → 0; `top` / `finish` → 100; `midline` → 50; `changeover` → 85
 */
export function resolveX(el: DiagramPos, allElements: DiagramElement[]): number {
  if (el.anchor) {
    const offset = el.offset ?? 0;
    const named: Record<string, number> = {
      start: 0, finish: 100, top: 100, midline: 50, changeover: 85,
    };
    if (el.anchor in named) return clampPct(named[el.anchor] + offset);
    const poleMatch = /^pole(\d+)$/i.exec(el.anchor);
    if (poleMatch) {
      const n = parseInt(poleMatch[1], 10);
      const poles = allElements.filter((e) => e.t === 'pole');
      const target = poles[n - 1];
      if (target && 'x' in target && typeof target.x === 'number') return clampPct(target.x + offset);
    }
  }
  if (typeof (el as DiagramPos).x === 'number') return clampPct((el as DiagramPos).x!);
  return 50;
}
