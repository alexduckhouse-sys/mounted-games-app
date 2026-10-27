import type { EntryKind } from '../../lib/entryOptions';

const PREFIX = 'mg.draft.entry.v1.';
export const ENTRY_DRAFT_LIFETIME = 7 * 24 * 60 * 60 * 1000;

/** Phone numbers and email addresses are deliberately absent (the entry may be for someone else, such as a child), and so is consent: reopening a draft always needs a fresh tick. */
export interface EntryDraft {
  fullName: string;
  club: string;
  teamName: string;
  wholeTeam: boolean;
  lookingForGuestRiders: boolean;
  teamsCount: number | '';
  stablesCount: number;
  stablingClubOrTeam: string;
  useInitialOnly: boolean;
  noFilming: boolean;
  requestId: string;
}

export function entryDraftKey(userId: string, competitionId: number, sectionId: number, kind: EntryKind): string {
  return PREFIX + JSON.stringify([userId, competitionId, sectionId, kind]);
}

function isDraft(value: unknown): value is EntryDraft {
  if (!value || typeof value !== 'object') return false;
  const d = value as Record<string, unknown>;
  return ['fullName', 'club', 'teamName', 'stablingClubOrTeam'].every((key) => typeof d[key] === 'string' && d[key].length <= 2000)
    && ['wholeTeam', 'lookingForGuestRiders', 'useInitialOnly', 'noFilming'].every((key) => typeof d[key] === 'boolean')
    && typeof d.requestId === 'string' && d.requestId.length > 0 && d.requestId.length <= 100
    && (d.teamsCount === '' || (Number.isInteger(d.teamsCount) && Number(d.teamsCount) >= 1 && Number(d.teamsCount) <= 20))
    && Number.isInteger(d.stablesCount) && Number(d.stablesCount) >= 0 && Number(d.stablesCount) <= 100;
}

function validEnvelope(value: unknown, now: number): value is { savedAt: number; details: EntryDraft } {
  if (!value || typeof value !== 'object') return false;
  const saved = value as { savedAt?: unknown; details?: unknown };
  return typeof saved.savedAt === 'number' && Number.isFinite(saved.savedAt)
    && saved.savedAt <= now && now - saved.savedAt < ENTRY_DRAFT_LIFETIME && isDraft(saved.details);
}

/** Invalid and expired drafts are removed, including those for events no longer visited. */
export function readEntryDraft(key: string, now = Date.now()): EntryDraft | null {
  try {
    for (const storedKey of Object.keys(localStorage).filter((item) => item.startsWith(PREFIX))) {
      let saved: unknown;
      try { saved = JSON.parse(localStorage.getItem(storedKey) ?? 'null'); } catch { saved = null; }
      if (!validEnvelope(saved, now)) localStorage.removeItem(storedKey);
    }
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    return validEnvelope(saved, now) ? saved.details : null;
  } catch { return null; }
}

export function saveEntryDraft(key: string, details: EntryDraft, now = Date.now()): boolean {
  try {
    // Whitelist fields rather than serialising state, which can also contain consent.
    const { fullName, club, teamName, wholeTeam, lookingForGuestRiders,
      teamsCount, stablesCount, stablingClubOrTeam, useInitialOnly, noFilming, requestId } = details;
    localStorage.setItem(key, JSON.stringify({ savedAt: now, details: {
      fullName, club, teamName, wholeTeam, lookingForGuestRiders,
      teamsCount, stablesCount, stablingClubOrTeam, useInitialOnly, noFilming, requestId,
    } }));
    return true;
  } catch { return false; }
}

export function clearEntryDraft(key: string): void {
  try { localStorage.removeItem(key); } catch { /* Storage may be unavailable. */ }
}
