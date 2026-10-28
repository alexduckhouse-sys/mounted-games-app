/** How the page changes when the route does: slide in (push), slide out (back) or a short crossfade. */
export type PageTransitionKind = 'push' | 'back' | 'fade';

export const PUSH_MS = 420;
export const FADE_MS = 160;
export const PUSH_EASING = 'cubic-bezier(.32,.72,0,1)';
export const FADE_EASING = 'ease-out';

/** The pages the bottom tab bar opens inside a competition. They sit side by side, one level down from the events list. */
const COMPETITION_TABS = new Set(['', 'toplists', 'following', 'chat', 'teams', 'declarations', 'shop', 'details', 'operations', 'scoring', 'enter']);
const GLOBAL_PATHS = new Set(['/', '/events', '/competitions', '/competitions/past', '/following', '/me', '/me/account', '/me/members', '/me/payouts', '/me/catalogue', '/me/orders', '/dashboard', '/teams', '/me/signups', '/shop']);

/**
 * How deep a page sits. The global tab pages are 0, a competition's tabs 1, and anything opened from those (a team, a heat,
 * the arena, rules) 2 or more. Other pages count their path segments.
 */
export function routeDepth(pathname: string): number {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (GLOBAL_PATHS.has(path)) return 0;
  const competition = /^\/competitions\/\d+(?:\/(.*))?$/.exec(path);
  if (competition) {
    const parts = (competition[1] ?? '').split('/').filter(Boolean);
    if (parts.length === 0) return 1;
    if (parts.length === 1 && COMPETITION_TABS.has(parts[0])) return 1;
    if (parts[0] === 'enter') return 1;
    return 1 + parts.length;
  }
  return Math.min(path.split('/').filter(Boolean).length, 3);
}

/**
 * Which transition a move from one page to another gets, or null when the page is the same (only the query changed).
 * Going deeper pushes and going shallower goes back; a back or forward button press (`popped`) counts as back unless it
 * lands deeper. Pages at the same level crossfade.
 */
export function transitionFor(from: string, to: string, popped: boolean): PageTransitionKind | null {
  if (from === to) return null;
  const before = routeDepth(from);
  const after = routeDepth(to);
  if (before === after) return 'fade';
  if (after > before) return popped ? 'back' : 'push';
  return 'back';
}

/**
 * Keyframes for the leaving and arriving page. In a push the arriving page is on top; going back, the leaving page is.
 * `top` says which of the two sits above.
 */
export function transitionPlan(kind: PageTransitionKind): { outgoing: Keyframe[]; incoming: Keyframe[]; top: 'outgoing' | 'incoming'; duration: number; easing: string } {
  if (kind === 'push') {
    return {
      outgoing: [{ transform: 'translateX(0)', filter: 'brightness(1)' }, { transform: 'translateX(-30%)', filter: 'brightness(.9)' }],
      incoming: [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }],
      top: 'incoming', duration: PUSH_MS, easing: PUSH_EASING,
    };
  }
  if (kind === 'back') {
    return {
      outgoing: [{ transform: 'translateX(0)' }, { transform: 'translateX(100%)' }],
      incoming: [{ transform: 'translateX(-30%)', filter: 'brightness(.9)' }, { transform: 'translateX(0)', filter: 'brightness(1)' }],
      top: 'outgoing', duration: PUSH_MS, easing: PUSH_EASING,
    };
  }
  return { outgoing: [{ opacity: 1 }, { opacity: 0 }], incoming: [{ opacity: 0.4 }, { opacity: 1 }], top: 'outgoing', duration: FADE_MS, easing: FADE_EASING };
}
