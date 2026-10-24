/**
 * Race points are whole or half points. Show `3` for a whole value and `2.5` for a half, never `2.50`.
 * Anything finer is rounded to the nearest half so a stray float can't print as `2.499999`.
 */
export function formatPoints(value: number): string {
  if (!Number.isFinite(value)) return '';
  const halves = Math.round(value * 2) / 2;
  return Number.isInteger(halves) ? String(halves + 0) : halves.toFixed(1);
}
