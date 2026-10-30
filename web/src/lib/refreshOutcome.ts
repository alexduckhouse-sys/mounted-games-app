/** How a tap on a refresh button ended: new data, the same data, no signal (a saved copy), or a server problem. */
export type RefreshOutcome = 'updated' | 'same' | 'offline' | 'failed';

/** A page's refresh. Return the outcome so the button can show it; a plain function just gets one turn of the arrow. */
export type RefreshHandler = () => void | Promise<RefreshOutcome | void>;

/** A failed request with the phone offline is "no signal", not a server problem. */
export function failedRefreshOutcome(): RefreshOutcome {
  return typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'failed';
}

/** Whether a fresh answer matches what is on screen, so the button can say "Up to date" rather than "Updated". */
export function refreshOutcomeFor(shown: unknown, fresh: unknown): RefreshOutcome {
  if (shown == null) return 'updated';
  try {
    return JSON.stringify(shown) === JSON.stringify(fresh) ? 'same' : 'updated';
  } catch {
    return 'updated';
  }
}
