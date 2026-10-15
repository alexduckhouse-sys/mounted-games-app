/** The competition id in /competitions/:id/..., or null on any other page. */
export function competitionIdFromPath(pathname: string): number | null {
  const match = /^\/competitions\/(\d+)(?:\/|$)/.exec(pathname);
  return match ? Number(match[1]) : null;
}
