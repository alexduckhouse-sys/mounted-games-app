export const SHOWGROUND_RADIO_TITLE = 'Showground Radio — Live Arena Commentary';

export interface ShowgroundRadioInfo {
  competitionName?: string | null;
  arenaName?: string | null;
  heatLabel?: string | null;
}

export interface ShowgroundRadioMetadata {
  title: string;
  artist: string;
  album: string;
}

/**
 * Formats the lock-screen / pocket audio metadata for Showground Radio.
 */
export function buildShowgroundRadioMetadata(info: ShowgroundRadioInfo): ShowgroundRadioMetadata {
  const competition = info.competitionName?.trim() || 'Mounted Games Live';
  const arena = info.arenaName?.trim() || 'Main Arena';
  const heat = info.heatLabel?.trim();
  return {
    title: heat ? `${arena} · ${heat}` : `${arena} — Live Commentary`,
    artist: competition,
    album: SHOWGROUND_RADIO_TITLE,
  };
}

/**
 * Sets or clears `navigator.mediaSession.metadata` so spectators can listen to
 * Showground Radio commentary with their phone locked in their pocket.
 */
export function syncShowgroundRadioMediaSession(
  active: boolean,
  info: ShowgroundRadioInfo,
): ShowgroundRadioMetadata | null {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !navigator.mediaSession) {
    return null;
  }

  if (!active) {
    try {
      navigator.mediaSession.metadata = null;
    } catch {
      // Ignore read-only mediaSession implementations in older WebViews.
    }
    return null;
  }

  const meta = buildShowgroundRadioMetadata(info);
  try {
    if (typeof MediaMetadata !== 'undefined') {
      navigator.mediaSession.metadata = new MediaMetadata(meta);
    } else {
      (navigator.mediaSession as { metadata: unknown }).metadata = meta;
    }
  } catch {
    // Ignore unsupported MediaMetadata constructor in constrained environments.
  }
  return meta;
}
