import { useEffect, useRef, useState } from 'react';
import { animate } from 'framer-motion';
import { confettiBurst, sparkleBurst } from '../components/bursts';
import { climbScale, MOVE_S, rankMoves, SPARKLE_CLIMB } from '../lib/motion';
import { useStillMotion } from '../lite/useStillMotion';

/**
 * Plays the moves between two orders of a list already on screen. Rows carry `data-rank-id`; the bits that swell
 * while climbing carry `data-grow` ("start" grows from its left edge, "end" from its right). A climbing row lifts,
 * its name and points swell more the further it climbs, a big climb trails sparkles, and a team crossing the final
 * cut-off throws confetti once it lands. Returns a stop function.
 */
export function playRankMoves(root: Element, before: number[], now: number[], { cutAfter = null, delayS = 0 }: { cutAfter?: number | null; delayS?: number } = {}): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  const stops: (() => void)[] = [];
  const later = (seconds: number, run: () => void) => timers.push(setTimeout(run, seconds * 1000));
  for (const move of rankMoves(before, now, cutAfter)) {
    const row = root.querySelector(`[data-rank-id="${move.id}"]`);
    if (!row) continue;
    if (move.climb > 0) {
      const peak = climbScale(move.climb);
      const swell = animate(row.querySelectorAll('[data-grow]'), { scale: [1, peak, peak, 1] }, { delay: delayS, duration: MOVE_S + 0.3, times: [0, 0.3, 0.7, 1], ease: 'easeInOut' });
      stops.push(() => swell.stop());
      later(delayS, () => row.classList.add('mg-rank-lift'));
      later(delayS + MOVE_S + 0.3, () => row.classList.remove('mg-rank-lift'));
      // A trail: a few sparkles from wherever the row has got to on its way up.
      if (move.climb >= SPARKLE_CLIMB) for (const at of [0.05, 0.2, 0.35, 0.5]) later(delayS + at, () => sparkleBurst(row, 4));
    }
    if (move.crossedIn) later(delayS + MOVE_S * 0.9, () => confettiBurst(row));
  }
  return () => {
    timers.forEach(clearTimeout);
    stops.forEach((stop) => stop());
  };
}

/**
 * For a list that re-sorts while people watch (toplists, heat tables): put the ref on the list and the moves play
 * whenever the order of `ids` changes. Nothing plays on first draw or when motion is stilled.
 */
export function useRankMotion<T extends Element>(ids: number[], cutAfter: number | null = null) {
  const ref = useRef<T>(null);
  const still = useStillMotion();
  const key = ids.join(',');
  const [order, setOrder] = useState({ key, ids, before: null as number[] | null });
  if (order.key !== key) setOrder({ key, ids, before: order.ids });
  useEffect(() => {
    if (still || !order.before || !ref.current) return;
    return playRankMoves(ref.current, order.before, order.ids, { cutAfter });
  }, [order, still, cutAfter]);
  return ref;
}
