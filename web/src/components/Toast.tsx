import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useStillMotion } from '../lite/useStillMotion';

/** How long a toast stays up. */
export const TOAST_MS = 2000;

/** One navy pill just above the bottom tabs with a small green tick. It never blocks a tap. */
export function Toast({ message }: { message: string }) {
  const still = useStillMotion();
  return (
    <motion.div
      role="status"
      className="kit-toast"
      initial={still ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={still ? undefined : { opacity: 0, y: 10, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', stiffness: 480, damping: 30 }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={still ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.28, delay: 0.1 }} />
      </svg>
      <span className="kit-toast-text">{message}</span>
    </motion.div>
  );
}

/**
 * The one way to say a quick thing worked ("Changes saved", "Link copied", "Race 3 sent"). `show(message)` plays it for
 * about two seconds; render `node` once on the page. Screen readers hear the message.
 */
// The hook lives beside the pill it renders.
// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): { show: (message: string) => void; node: ReactNode } {
  const [shown, setShown] = useState<{ id: number; message: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useRef(0);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const show = useCallback((message: string) => {
    nextId.current += 1;
    setShown({ id: nextId.current, message });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(null), TOAST_MS);
  }, []);
  const node = <AnimatePresence>{shown && <Toast key={shown.id} message={shown.message} />}</AnimatePresence>;
  return { show, node };
}
