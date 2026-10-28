import type { ReactNode } from 'react';
import { TickerProvider, useTicker } from '../components/TickerContext';

/** Shows the page's dock button the way the shell does, so a test can click it and read its badge. */
function DockProbe() {
  const { dockAction } = useTicker();
  if (!dockAction) return null;
  return (
    <button type="button" data-testid="dock" data-icon={dockAction.icon} data-count={dockAction.count} aria-label={dockAction.label} onClick={dockAction.onClick} />
  );
}

/** Wrap a page in this to give it a ticker dock, as it has in the app. */
export function WithDock({ children }: { children: ReactNode }) {
  return <TickerProvider><DockProbe />{children}</TickerProvider>;
}
