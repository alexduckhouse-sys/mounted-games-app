/** An hour out the ring is full; it empties as the heat comes closer. */
export const RING_WINDOW_MIN = 60;
/** From this many minutes out the ring turns amber. */
export const RING_SOON_MIN = 5;

export interface RingState {
  /** Whole minutes to go, rounded up; 0 once the heat is due or on. */
  minutes: number;
  /** How much of the ring is left, 0 to 1. */
  fill: number;
  tone: 'wait' | 'soon' | 'due' | 'live';
}

/** Where a followed team's countdown ring stands, or null when the heat is more than an hour away or has no time yet. */
export function ringState(at: Date | null | undefined, live: boolean, now: Date): RingState | null {
  if (live) return { minutes: 0, fill: 1, tone: 'live' };
  if (!at) return null;
  const minutes = Math.ceil((at.getTime() - now.getTime()) / 60_000);
  if (minutes > RING_WINDOW_MIN) return null;
  if (minutes <= 0) return { minutes: 0, fill: 0, tone: 'due' };
  return { minutes, fill: minutes / RING_WINDOW_MIN, tone: minutes <= RING_SOON_MIN ? 'soon' : 'wait' };
}

/** What a screen reader hears for the ring. */
export function ringLabel(state: RingState): string {
  if (state.tone === 'live') return 'On now';
  if (state.tone === 'due') return 'Due now';
  return `Starts in ${state.minutes} ${state.minutes === 1 ? 'minute' : 'minutes'}`;
}
