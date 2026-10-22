import { useContext } from 'react';
import type { StreamOverlay } from '../types';
import { CompetitionContext } from '../pages/competition/context';
import { DEFAULT_OVERLAY, parseLook, type OverlayLook } from '../lib/overlays';
import type { QueuedScoreCard } from '../lib/scoreCard';

const NO_CARDS: QueuedScoreCard[] = [];

/** The competition's overlays and parsed look; defaults outside a competition page or before they load. */
export function useOverlay(): { overlay: StreamOverlay; look: OverlayLook; scoreCards: QueuedScoreCard[] } {
  const context = useContext(CompetitionContext);
  const overlay = context?.overlay ?? DEFAULT_OVERLAY;
  return { overlay, look: parseLook(overlay.look), scoreCards: context?.scoreCards ?? NO_CARDS };
}
