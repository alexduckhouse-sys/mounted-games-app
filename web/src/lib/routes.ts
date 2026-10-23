/** The competition id in /competitions/:id/..., or null on any other page. */
export function competitionIdFromPath(pathname: string): number | null {
  const match = /^\/competitions\/(\d+)(?:\/|$)/.exec(pathname);
  return match ? Number(match[1]) : null;
}

/** Pages that belong to no competition and show the Events, Following, Live, Me tabs. */
export const GLOBAL_EVENTS = ['/', '/competitions', '/competitions/past'];
export const GLOBAL_ME = ['/dashboard', '/teams', '/me/signups', '/shop'];

/** The path without a trailing slash (the root stays "/"). */
export function globalTabsPath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
}

/** True for the pages that carry the global tab bar. */
export function hasGlobalTabs(pathname: string): boolean {
  const path = globalTabsPath(pathname);
  return GLOBAL_EVENTS.includes(path) || GLOBAL_ME.includes(path) || path === '/following' || path === '/chat';
}

/** The statistics hub (`/stats` and `/stats/:kind`): a public page in the EGUK look, without the global tab bar. */
export function isStatsPath(pathname: string): boolean {
  const path = globalTabsPath(pathname);
  return path === '/stats' || path.startsWith('/stats/');
}
