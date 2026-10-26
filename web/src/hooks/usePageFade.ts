import { useEffect, useRef, type RefObject } from 'react';
import { useStillMotion } from '../lite/useStillMotion';

/** How long the page takes to come up after moving to another one. */
export const PAGE_FADE_MS = 200;

/**
 * Brings the page in with a short fade each time `page` changes (not on the first render), so going from one page to
 * the next reads as one app rather than a cut. Opacity only: a transform here would unpin the fixed bars inside the
 * page while it ran. Pages that already animate `.rf-page` skip this so the entry doesn't run twice. Nothing is
 * remounted, and lite mode and reduced motion skip it.
 */
export function usePageFade(ref: RefObject<HTMLElement | null>, page: string): void {
  const still = useStillMotion();
  const shown = useRef(page);
  useEffect(() => {
    if (shown.current === page) return;
    shown.current = page;
    const element = ref.current;
    if (still || !element || typeof element.animate !== 'function' || element.classList.contains('rf-page') || element.querySelector('.rf-page')) return;
    element.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: PAGE_FADE_MS, easing: 'cubic-bezier(.22, 1, .36, 1)' });
  }, [page, ref, still]);
}
