/**
 * Shared timings for broadcast-style motion: overlays on the live video, the replay wipe and the TV kiosk.
 * Graphics come in quickly with a soft landing and leave faster than they arrived, like TV graphics.
 */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
export const EASE_IN = [0.64, 0, 0.78, 0] as const;

export const SPRING = { type: 'spring', stiffness: 360, damping: 28 } as const;
export const ENTER = { duration: 0.38, ease: EASE_OUT } as const;
export const LEAVE = { duration: 0.22, ease: EASE_IN } as const;

/** How long rows of a fresh score card hold their old order before sliding to the new one. */
export const SHUFFLE_DELAY_S = 0.6;
export const SHUFFLE_S = 0.55;

/** Seconds between each row of a card arriving. */
export const ROW_STAGGER_S = 0.04;

/** Clip paths for wiping a graphic on from one edge and off the other. */
export const WIPE_HIDDEN_LEFT = 'inset(0% 100% 0% 0%)';
export const WIPE_SHOWN = 'inset(0% 0% 0% 0%)';
export const WIPE_HIDDEN_RIGHT = 'inset(0% 0% 0% 100%)';
export const WIPE_HIDDEN_BOTTOM = 'inset(100% 0% 0% 0%)';

/**
 * A diagonal edge that sweeps left to right: hidden at the left, shown, then hidden at the right.
 * The shape reaches 10% past every side so shadows and focus rings aren't cut off while it rests.
 */
export const DIAGONAL_HIDDEN_LEFT = 'polygon(-10% -10%, -10% -10%, -30% 110%, -30% 110%)';
export const DIAGONAL_SHOWN = 'polygon(-10% -10%, 130% -10%, 110% 110%, -30% 110%)';
export const DIAGONAL_HIDDEN_RIGHT = 'polygon(130% -10%, 130% -10%, 110% 110%, 110% 110%)';

interface RankedRow {
  teamId: number;
  total: number;
  added: number;
  teamName: string;
}

/**
 * Where each row of a score card sat before the race just scored, as a map of team to its old index.
 * Rows are re-ranked on their total before this race; ties keep name order, as the card itself does.
 */
export function previousSlots(rows: RankedRow[]): Map<number, number> {
  const before = rows
    .map((row) => ({ teamId: row.teamId, teamName: row.teamName, total: row.total - row.added }))
    .sort((a, b) => b.total - a.total || a.teamName.localeCompare(b.teamName));
  return new Map(before.map((row, index) => [row.teamId, index]));
}

/** A value part-way between two point totals, kept to whole or half points so the count reads cleanly. */
export function countStep(from: number, to: number, progress: number): number {
  if (progress >= 1) return to;
  return Math.round((from + (to - from) * Math.max(0, progress)) * 2) / 2;
}
