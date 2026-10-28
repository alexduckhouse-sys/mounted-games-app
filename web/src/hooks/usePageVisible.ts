import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}
const visible = () => document.visibilityState !== 'hidden';

/** False while the tab or app is in the background, so a page can stop work nobody can see (live previews, polling). */
export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribe, visible);
}
