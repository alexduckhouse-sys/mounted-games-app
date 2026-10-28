import { api } from '../../api';
import { scorerLinkUrl } from '../../offline/scorerLink';
import type { CreatedScorerLink, ScorerLink } from '../../types';

/** A staff-sheet entry: the link it stands for and the address its QR code opens. */
export interface PosterLink { link: ScorerLink; url: string }

/** Links still usable at `now`: not withdrawn and not expired. */
export function activeScorerLinks(links: ScorerLink[], now: number): ScorerLink[] {
  return links.filter((l) => !l.revokedAt && new Date(l.expiresAt).getTime() > now);
}

/**
 * The server keeps only a hash of a scorer token, so an existing link can't be turned back into a QR code. For the
 * printed staff sheet, make a fresh link with the same label, arena, scope and expiry for each active one and encode
 * its real `/score#t=<token>` address. The old links keep working.
 */
export async function mintPosterLinks(competitionId: string | number, existing: ScorerLink[], origin: string, now = Date.now()): Promise<PosterLink[]> {
  const minted = await Promise.all(activeScorerLinks(existing, now).map(async (old) => {
    const { data } = await api.post<CreatedScorerLink>(`/competitions/${competitionId}/scorer-links`, {
      label: old.label,
      arenaName: old.arenaName,
      expiresAt: old.expiresAt,
      ...(old.scope ? { scope: old.scope } : {}),
    });
    return { link: data.link, url: scorerLinkUrl(origin, data.token) };
  }));
  return minted;
}
