import { useEffect, useState } from 'react';
import { FRESH_ROTATION, msUntilNext, rotationIndex, skipRotation } from '../lib/sponsors';

/**
 * Which of `count` sponsors is on screen, changing every `intervalMs` on the clock so every viewer sees the
 * same one. A new skip (the producer's `skip.count` going up) moves on at once and starts a fresh turn.
 * A skip that happened before this mounted is ignored. Returns -1 when there is nobody to show.
 */
export function useSponsorRotation(count: number, intervalMs: number, skip: { count: number; at: number }): number {
  const [rotation, setRotation] = useState(FRESH_ROTATION);
  const [now, setNow] = useState(() => Date.now());
  const [seen, setSeen] = useState(skip.count);
  if (skip.count !== seen) {
    setSeen(skip.count);
    setRotation(skipRotation(rotation, skip.at, intervalMs, count));
    setNow(skip.at);
  }

  useEffect(() => {
    if (count <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), msUntilNext(Date.now(), rotation, intervalMs) + 20);
    return () => clearTimeout(timer);
  }, [now, rotation, intervalMs, count]);

  return rotationIndex(now, rotation, intervalMs, count);
}
