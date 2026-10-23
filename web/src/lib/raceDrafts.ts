const key = (competitionId: number) => `mg.format.races.v1.${competitionId}`;

/** Race lists the organiser has chosen for sessions whose heats aren't generated yet. Kept on this device, per competition. */
export function readRaceDrafts(competitionId: number): Record<number, string[]> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key(competitionId)) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<number, string[]> = {};
    for (const [id, races] of Object.entries(parsed)) {
      const sessionId = Number(id);
      if (Number.isSafeInteger(sessionId) && Array.isArray(races) && races.every((race) => typeof race === 'string')) out[sessionId] = races;
    }
    return out;
  } catch { return {}; }
}

/** Saves one session's list, or forgets it when `races` is null. */
export function writeRaceDraft(competitionId: number, sessionId: number, races: string[] | null): Record<number, string[]> {
  const next = { ...readRaceDrafts(competitionId) };
  if (races === null) delete next[sessionId]; else next[sessionId] = races;
  try {
    if (Object.keys(next).length) localStorage.setItem(key(competitionId), JSON.stringify(next));
    else localStorage.removeItem(key(competitionId));
  } catch { /* storage full or blocked: the list still works until the page closes */ }
  return next;
}
