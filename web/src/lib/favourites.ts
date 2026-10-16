/** Public team IDs only. Following never grants access to a team's private records. */
export interface FavouriteTeam { competitionId: number; teamId: number }
export const FAVOURITES_KEY = 'mg.favourites.v1';
export const FAVOURITES_CHANGED = 'mg:favourites';
const MAX_FAVOURITES = 100;

function valid(value: unknown): value is FavouriteTeam {
  if (!value || typeof value !== 'object') return false;
  const item = value as FavouriteTeam;
  return Number.isSafeInteger(item.competitionId) && item.competitionId > 0
    && Number.isSafeInteger(item.teamId) && item.teamId > 0;
}

export function readFavourites(): FavouriteTeam[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(FAVOURITES_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    const unique = new Map<string, FavouriteTeam>();
    for (const item of parsed) {
      if (valid(item)) unique.set(`${item.competitionId}:${item.teamId}`, { competitionId: item.competitionId, teamId: item.teamId });
    }
    return [...unique.values()].slice(0, MAX_FAVOURITES);
  } catch { return []; }
}

export function toggleFavourite(item: FavouriteTeam): string | null {
  if (!valid(item)) return 'This team couldn’t be followed. Refresh the page and try again.';
  const current = readFavourites();
  const exists = current.some((f) => f.competitionId === item.competitionId && f.teamId === item.teamId);
  if (!exists && current.length >= MAX_FAVOURITES) return 'You’re following 100 teams. Remove a team before adding another.';
  const next = exists ? current.filter((f) => f.competitionId !== item.competitionId || f.teamId !== item.teamId)
    : [...current, { competitionId: item.competitionId, teamId: item.teamId }];
  try {
    if (next.length) localStorage.setItem(FAVOURITES_KEY, JSON.stringify(next));
    else localStorage.removeItem(FAVOURITES_KEY);
  } catch { return 'Your choice couldn’t be saved on this device. Check your browser’s storage settings and try again.'; }
  window.dispatchEvent(new Event(FAVOURITES_CHANGED));
  return null;
}
