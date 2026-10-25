import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useStillMotion } from '../lite/useStillMotion';

/** How long the tick stays on screen. */
export const SAVED_TICK_MS = 1300;

/**
 * A green tick that pops up over the page when something is saved, draws itself in, then fades. It never blocks a
 * tap, so a scorer can carry on with the next race underneath. Screen readers hear "<label> saved".
 * `show(label)` plays it; render `node` once.
 */
export function useSavedTick(): { show: (label: string) => void; node: ReactNode } {
  const still = useStillMotion();
  const [shown, setShown] = useState<{ id: number; label: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useRef(0);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const show = useCallback((label: string) => {
    nextId.current += 1;
    setShown({ id: nextId.current, label });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(null), SAVED_TICK_MS);
  }, []);
  const node = (
    <AnimatePresence>
      {shown && (
        <motion.div
          key={shown.id}
          role="status"
          className="mg-saved-tick"
          initial={still ? false : { opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={still ? undefined : { opacity: 0, scale: 0.92, transition: { duration: 0.22 } }}
          transition={{ type: 'spring', stiffness: 520, damping: 22 }}
        >
          <span className="mg-saved-tick-disc" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="34" height="34">
              <motion.path
                d="M5 12.5l4.5 4.5L19 7.5"
                initial={still ? false : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.32, delay: 0.12, ease: 'easeOut' }}
              />
            </svg>
          </span>
          <span className="mg-saved-tick-label">{shown.label} saved</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
  return { show, node };
}
