import { useEffect, useState } from 'react';
import { useStillMotion } from '../lite/useStillMotion';

/** How long a revealed panel takes to fold away (matches the `sv-reveal` animation in seasonViews.css). */
export const REVEAL_MS = 200;

/**
 * Keeps a panel mounted while it folds away. `mounted` says whether to render it and `leaving` whether it is on its
 * way out (add a class that plays the leave animation). With lite mode or reduced motion it goes at once.
 */
export function useReveal(open: boolean, ms = REVEAL_MS): { mounted: boolean; leaving: boolean } {
  const still = useStillMotion();
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  useEffect(() => {
    if (open || !mounted || still) return;
    const timer = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(timer);
  }, [open, mounted, still, ms]);
  if (still) return { mounted: open, leaving: false };
  return { mounted: open || mounted, leaving: !open && mounted };
}
