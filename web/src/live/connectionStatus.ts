/** What the connection pill shows. `connecting` and `live` show nothing. */
export type LiveState = 'live' | 'connecting' | 'reconnecting' | 'polling' | 'offline';

export interface ConnectionInputs {
  /** The live hub has joined the competition. */
  connected: boolean;
  /** The browser thinks it has a network. */
  online: boolean;
  /** Timetable checks that failed in a row since the last success. */
  failures: number;
  /** When the live link was last lost (ms since epoch), or null while connected. */
  downSince: number | null;
  /** Whether the live link has worked at all since the page opened. */
  everConnected: boolean;
}

/** A short drop or the first connect shouldn't flash a pill. */
export const GRACE_MS = 3_000;
/** After this long without the live link, say we're checking instead of reconnecting. */
export const RECONNECT_MS = 20_000;

const FOCUS_PAGE = /\/competitions\/\d+\/(?:session\/\d+|scoring)\/?$/;

/** Scoring and heat pages need the freshest results, so they check more often. */
export function isFocusPage(pathname: string): boolean {
  return FOCUS_PAGE.test(pathname);
}

/** How often to check for changes while the live link is down: 15 s or 30 s, backing off to 60 s after repeated failures. */
export function pollIntervalMs(focusPage: boolean, failures: number): number {
  if (failures >= 3) return 60_000;
  return focusPage ? 15_000 : 30_000;
}

export function liveState(inputs: ConnectionInputs, now: number): LiveState {
  if (inputs.connected) return 'live';
  if (!inputs.online || inputs.failures > 0) return 'offline';
  const downFor = inputs.downSince == null ? 0 : now - inputs.downSince;
  if (downFor < GRACE_MS) return 'connecting';
  if (inputs.everConnected && downFor < RECONNECT_MS) return 'reconnecting';
  return 'polling';
}
