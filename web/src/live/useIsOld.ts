import { useEffect, useState } from 'react';
import { LIVE_SAVED_COPY_NOTICE_AFTER_MS } from '../offline/savedCopies';

/**
 * True once `at` is older than `thresholdMs`, and it flips by itself when that moment passes, so a notice about
 * old data appears without waiting for something else to re-render the page. A time we don't know counts as old.
 */
export function useIsOld(at: Date | string | number | null | undefined, thresholdMs = LIVE_SAVED_COPY_NOTICE_AFTER_MS): boolean {
  const parsed = at == null || at === '' ? Number.NaN : at instanceof Date ? at.getTime() : typeof at === 'number' ? at : Date.parse(at);
  const time = Number.isNaN(parsed) ? null : parsed;
  const [oldFor, setOldFor] = useState<number | null>(null);
  useEffect(() => {
    if (time === null) return;
    const timer = setTimeout(() => setOldFor(time), Math.max(time + thresholdMs - Date.now(), 0));
    return () => clearTimeout(timer);
  }, [time, thresholdMs]);
  return time === null || oldFor === time;
}
