import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useStillMotion } from '../lite/useStillMotion';

/** How long a toast stays up. One with an action ("Undo") stays longer, so there is time to reach it. */
export const TOAST_MS = 2000;
export const TOAST_ACTION_MS = 5000;

export interface ToastOptions {
  /** A button on the pill, such as "Undo". Pressing it runs `onClick` and puts the toast away. */
  action?: { label: string; onClick: () => void };
  /** Something that did not work: a small "!" instead of the tick. */
  error?: boolean;
}

/** One navy pill just above the bottom tabs with a small green tick. It never blocks a tap. */
export function Toast({ message, action, error = false, onAction }: { message: string; action?: { label: string }; error?: boolean; onAction?: () => void }) {
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
      <svg viewBox="0 0 24 24" aria-hidden="true" data-tone={error ? 'error' : undefined}>
        <motion.path d={error ? 'M12 6.5v6.5M12 17.2v.3' : 'M5 12.5l4.5 4.5L19 7.5'} initial={still ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.28, delay: 0.1 }} />
      </svg>
      <span className="kit-toast-text">{message}</span>
      {action && <button type="button" className="kit-toast-act" onClick={onAction}>{action.label}</button>}
    </motion.div>
  );
}

/**
 * The one way to say a quick thing worked ("Changes saved", "Link copied", "Race 3 sent"). `show(message)` plays it for
 * about two seconds (five with an `action` such as Undo, and `error` swaps the tick for a "!"); render `node` once on the page. Screen readers hear the message.
 */
// The hook lives beside the pill it renders.
// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): { show: (message: string, options?: ToastOptions) => void; node: ReactNode } {
  const [shown, setShown] = useState<{ id: number; message: string; options?: ToastOptions } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useRef(0);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const show = useCallback((message: string, options?: ToastOptions) => {
    nextId.current += 1;
    setShown({ id: nextId.current, message, options });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(null), options?.action ? TOAST_ACTION_MS : TOAST_MS);
  }, []);
  const act = () => {
    if (timer.current) clearTimeout(timer.current);
    shown?.options?.action?.onClick();
    setShown(null);
  };
  const node = <AnimatePresence>{shown && <Toast key={shown.id} message={shown.message} error={shown.options?.error} action={shown.options?.action} onAction={act} />}</AnimatePresence>;
  return { show, node };
}
