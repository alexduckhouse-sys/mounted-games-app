import { useCallback, useEffect, useRef, useState } from 'react';
import { useStillMotion } from '../lite/useStillMotion';

/** How long a sheet, drawer or dialog takes to leave: long enough for the dim behind it to fade out (skin.css). */
export const EXIT_MS = 380;

/**
 * Lets something that its parent removes on close play a leave animation first. `close()` marks it `closing`
 * (add a class for the leave animation) and calls `onDone` once the animation has had time to run. With lite mode
 * or reduced motion it closes at once. A second `close()` while closing does nothing.
 */
export function useExitDelay<A extends unknown[]>(onDone: (...args: A) => void): { closing: boolean; close: (...args: A) => void } {
  const still = useStillMotion();
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const close = useCallback((...args: A) => {
    if (still) { onDone(...args); return; }
    if (timer.current) return;
    setClosing(true);
    timer.current = setTimeout(() => onDone(...args), EXIT_MS);
  }, [still, onDone]);
  return { closing, close };
}
