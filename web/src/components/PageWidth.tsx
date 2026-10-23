import { useMemo, useState, type ReactNode } from 'react';
import { SetWidthContext, WidthContext, type PageWidth } from './pageWidthState';

/** Held by AppShell: the header and the page area both read the current width (see pageWidthState.ts). */
export function PageWidthProvider({ children }: { children: (width: PageWidth) => ReactNode }) {
  const [width, setWidth] = useState<PageWidth>('default');
  const set = useMemo(() => setWidth, []);
  return (
    <SetWidthContext.Provider value={set}>
      <WidthContext.Provider value={width}>{children(width)}</WidthContext.Provider>
    </SetWidthContext.Provider>
  );
}
