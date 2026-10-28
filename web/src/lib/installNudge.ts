/**
 * The gentle "add to your Home Screen" card: shown on phones from the third visit, until it's put away.
 * A visit is one browser session; the count lives in localStorage (`mg.install.visits`), the session flag in
 * sessionStorage so a reload doesn't count twice.
 */

const VISITS_KEY = 'mg.install.visits';
const COUNTED_KEY = 'mg.install.counted';
const DISMISSED_KEY = 'mg.install.dismissed';

/** The card first shows on this visit. */
export const NUDGE_FROM_VISIT = 3;

// Full-screen tools and kiosks, and pages with a box at the bottom, where a card would get in the way.
const QUIET_PAGES = /^\/competitions\/\d+\/(tv|broadcast|produce|stream-controls|commentary|session|chat|messages|enter)(\/|$)/;

/**
 * False on the TV kiosk, the camera and producer pages, scoring and message pages, anywhere outside the app shell,
 * and on Settings (which has its own Install row).
 */
export function nudgeAllowedOn(pathname: string): boolean {
  if (/^\/(embed|score|login|signup|invite|settings)(\/|$)/.test(pathname)) return false;
  return !QUIET_PAGES.test(pathname);
}

function visits(): number {
  try {
    const n = Number(localStorage.getItem(VISITS_KEY));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

/** Counts this visit once per browser session and returns the total so far. */
export function countVisit(): number {
  try {
    if (sessionStorage.getItem(COUNTED_KEY)) return visits();
    sessionStorage.setItem(COUNTED_KEY, '1');
    const next = visits() + 1;
    localStorage.setItem(VISITS_KEY, String(next));
    return next;
  } catch {
    return visits();
  }
}

/** True when the card has been put away on this device. Storage that can't be read counts as put away. */
export function nudgeDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) != null;
  } catch {
    return true;
  }
}

/** Remembers that the card was put away, so it doesn't come back. */
export function dismissNudge(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, new Date().toISOString());
  } catch { /* storage blocked: it just shows again next visit */ }
}
