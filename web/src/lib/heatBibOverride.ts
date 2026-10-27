import { api } from '../api';
import { normaliseBibColourKey, SPARE_BIB_COLOURS, type HeatBibEntryLike } from './bib';

/** The first spare bib colour no team in the heat is already wearing, or null when all are taken. */
export function suggestFreeBibColour(entries: readonly HeatBibEntryLike[]): string | null {
  const used = new Set(entries.map((e) => normaliseBibColourKey(e.bibColourOverride || e.bibColour)).filter(Boolean));
  return SPARE_BIB_COLOURS.find((c) => !used.has(c)) ?? null;
}

/** Set (or with null, clear) one team's bib colour for a single heat. */
export async function setHeatEntryBibOverride(
  competitionId: number,
  sessionId: number,
  heatId: number,
  teamId: number,
  colour: string | null,
): Promise<void> {
  await api.put(
    `/competitions/${competitionId}/sessions/${sessionId}/heats/${heatId}/entries/${teamId}/bib-override`,
    { bibColourOverride: colour },
  );
}
