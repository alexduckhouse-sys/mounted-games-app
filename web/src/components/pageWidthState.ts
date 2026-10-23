import { createContext, useContext, useLayoutEffect } from 'react';

/**
 * How wide the page area may grow on a laptop. Phones are never affected: these only cap the width.
 * - `narrow`  576px, a single phone-sized column
 * - `default` 1024px, the old cap (pages that haven't opted in)
 * - `wide`    1120px, two-column pages
 * - `full`    1360px, boards and tables
 */
export type PageWidth = 'narrow' | 'default' | 'wide' | 'full';

// Full class names so Tailwind can see them.
export const PAGE_WIDTH_CLASS: Record<PageWidth, string> = {
  narrow: 'max-w-xl',
  default: 'max-w-5xl',
  wide: 'max-w-[1120px]',
  full: 'max-w-[1360px]',
};

export const WidthContext = createContext<PageWidth>('default');
export const SetWidthContext = createContext<((width: PageWidth) => void) | null>(null);

export function usePageWidthValue(): PageWidth {
  return useContext(WidthContext);
}

/** A page calls this once to ask for more (or less) room. It goes back to the default when the page unmounts. */
export function usePageWidth(width: PageWidth): void {
  const set = useContext(SetWidthContext);
  useLayoutEffect(() => {
    if (!set) return;
    set(width);
    return () => set('default');
  }, [set, width]);
}
