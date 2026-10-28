/** What the connection pill shows. `connecting` and `live` show nothing. */
export type LiveState = 'live' | 'connecting' | 'polling' | 'unreachable' | 'offline';

export interface ConnectionInputs {
  /** The live hub has joined the competition. */
  connected: boolean;
  /** The browser thinks it has a network. */
  online: boolean;
  /** Timetable checks that failed in a row since the last success. */
  failures: number;
  /** When the live link was last lost (ms since epoch), or null while connected. */
  downSince: number | null;
}

/**
 * A drop or the first connect shouldn't flash a pill. The hub is a scale-to-zero container, so a cold
 * start plus the join can take several seconds, and a phone waking up needs a moment to reconnect.
 */
export const GRACE_MS = 15_000;
/** A device that reports no network is believed after this short wait, so a Wi-Fi blip stays quiet. */
export const OFFLINE_GRACE_MS = 5_000;
/** Timetable checks that must fail in a row before the server counts as unreachable rather than just slow. */
export const UNREACHABLE_FAILURES = 2;

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
  const downFor = inputs.downSince == null ? 0 : now - inputs.downSince;
  if (!inputs.online) return downFor < OFFLINE_GRACE_MS ? 'connecting' : 'offline';
  // Failed timetable checks only matter once the live link has stayed down too: one slow request
  // during a routine reconnect isn't news.
  if (downFor < GRACE_MS) return 'connecting';
  return inputs.failures >= UNREACHABLE_FAILURES ? 'unreachable' : 'polling';
}
