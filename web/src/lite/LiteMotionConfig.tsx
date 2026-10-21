import type { ReactNode } from 'react';
import { MotionConfig } from 'framer-motion';
import { useLiteMode } from './LiteModeContext';

/** Turns Framer Motion animations off in lite mode; otherwise follows the device's reduced-motion setting. */
export function LiteMotionConfig({ children }: { children: ReactNode }) {
  const { lite } = useLiteMode();
  return <MotionConfig reducedMotion={lite ? 'always' : 'user'}>{children}</MotionConfig>;
}
