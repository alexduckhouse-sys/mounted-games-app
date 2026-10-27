import { useEffect } from 'react';
import {
  buildShowgroundRadioMetadata,
  SHOWGROUND_RADIO_TITLE,
  syncShowgroundRadioMediaSession,
  type ShowgroundRadioInfo,
} from '../lib/showgroundRadio';

/**
 * Keeps `navigator.mediaSession.metadata` synchronised while Showground Radio
 * (audio-only live arena commentary mode) is active.
 */
export function useShowgroundRadio(active: boolean, info: ShowgroundRadioInfo) {
  const { competitionName, arenaName, heatLabel } = info;

  useEffect(() => {
    syncShowgroundRadioMediaSession(active, { competitionName, arenaName, heatLabel });
    return () => {
      if (active) {
        syncShowgroundRadioMediaSession(false, {});
      }
    };
  }, [active, competitionName, arenaName, heatLabel]);

  return {
    bannerTitle: SHOWGROUND_RADIO_TITLE,
    metadata: buildShowgroundRadioMetadata(info),
  };
}
