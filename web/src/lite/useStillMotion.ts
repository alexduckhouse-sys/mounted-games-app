import { useContext } from 'react';
import { MotionConfigContext, useReducedMotion } from 'framer-motion';

/**
 * True when animations should be skipped: lite mode (MotionConfig 'always') or the device's reduced-motion setting.
 * Framer only stills transforms by itself, so wipes, clip paths and counters check this.
 */
export function useStillMotion(): boolean {
  const { reducedMotion } = useContext(MotionConfigContext);
  const device = useReducedMotion();
  // Framer's default context says 'never', so anything short of 'always' falls back to the device setting.
  return reducedMotion === 'always' || Boolean(device);
}
