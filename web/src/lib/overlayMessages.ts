import type { OverlayBannerStyle } from '../types';

/** A banner a producer saved on this device to reuse; kept per competition in localStorage. */
export interface SavedMessage { text: string; style: OverlayBannerStyle }

const key = (competitionId: number) => `mg.overlay.messages.${competitionId}`;

export function readMessages(competitionId: number): SavedMessage[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key(competitionId)) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((m): m is SavedMessage =>
      typeof m === 'object' && m !== null && typeof m.text === 'string' && [0, 1, 2].includes(m.style));
  } catch {
    return [];
  }
}

export function writeMessages(competitionId: number, messages: SavedMessage[]) {
  try { localStorage.setItem(key(competitionId), JSON.stringify(messages)); } catch { /* storage blocked: kept for this visit only */ }
}
