import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useStillMotion } from '../lite/useStillMotion';

const ARRIVING = { opacity: 0, y: -6 };
const SHOWN = { opacity: 1, y: 0 };
// The row folds shut, padding and all, so the rows under it close the gap rather than jumping up.
const LEAVING = {
  opacity: 0, height: 0, minHeight: 0, paddingTop: 0, paddingBottom: 0, overflow: 'hidden',
  transition: { duration: 0.26, ease: [0.4, 0, 0.2, 1] },
} as const;

/**
 * A row in a list that people add to and take from (trainer requests, blocked accounts, invites): a new row drops in and
 * a removed one folds away. Put the rows straight inside `<AnimatePresence initial={false}>`, keyed, so the rows already
 * there when the page opens stay still. Lite mode and reduced motion skip both.
 */
export function LeavingRow({ as = 'li', className, children }: { as?: 'li' | 'div'; className?: string; children: ReactNode }) {
  const still = useStillMotion();
  const Row = as === 'div' ? motion.div : motion.li;
  return (
    <Row className={className} initial={still ? false : ARRIVING} animate={SHOWN} exit={still ? undefined : LEAVING} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </Row>
  );
}
