export interface CurrentCompetition {
  id: number;
  name: string;
}

const COOKIE_NAME = 'mg.competition';

export function readCompetitionCookie(cookies: string): CurrentCompetition | null {
  const value = cookies.split('; ').find((part) => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(value));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const c = parsed as Partial<CurrentCompetition>;
    return Number.isSafeInteger(c.id) && (c.id ?? 0) > 0 && typeof c.name === 'string' && c.name.length > 0
      ? { id: c.id as number, name: c.name } : null;
  } catch {
    return null;
  }
}

export function competitionCookie(current: CurrentCompetition | null, secure: boolean): string {
  const value = current ? encodeURIComponent(JSON.stringify(current)) : '';
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${current ? 60 * 60 * 24 * 180 : 0}; SameSite=Lax${secure ? '; Secure' : ''}`;
}
