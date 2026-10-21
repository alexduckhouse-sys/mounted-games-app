import { useContext } from 'react';
import type { StreamOverlay } from '../types';
import { CompetitionContext } from '../pages/competition/context';
import { DEFAULT_OVERLAY, parseLook, type OverlayLook } from '../lib/overlays';

/** The competition's overlays and parsed look; defaults outside a competition page or before they load. */
export function useOverlay(): { overlay: StreamOverlay; look: OverlayLook } {
  const overlay = useContext(CompetitionContext)?.overlay ?? DEFAULT_OVERLAY;
  return { overlay, look: parseLook(overlay.look) };
}
