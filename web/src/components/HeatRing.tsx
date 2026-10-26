import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useNow } from '../hooks/useNow';
import { ringLabel, ringState } from '../lib/heatRing';
import { useStillMotion } from '../lite/useStillMotion';

const R = 11;
const LENGTH = 2 * Math.PI * R;

/**
 * A small ring counting down to a followed team's heat: full an hour out, emptying as it comes closer, amber in the
 * last five minutes and red, gently pulsing, once the heat is on. The minutes to go sit inside it. More than an hour
 * out (or with no time yet) it shows `fallback` instead, if given.
 */
export function HeatRing({ at, live, fallback = null }: { at: Date | null | undefined; live: boolean; fallback?: ReactNode }) {
  const now = useNow(15_000);
  const still = useStillMotion();
  const state = ringState(at, live, now);
  if (!state) return <>{fallback}</>;
  const offset = LENGTH * (1 - state.fill);
  return (
    <span className="mg-heat-ring" data-tone={state.tone} role="img" aria-label={ringLabel(state)}>
      <svg viewBox="0 0 28 28" aria-hidden="true">
        <circle className="mg-heat-ring-track" cx="14" cy="14" r={R} />
        {/* It draws round to where it stands as it appears, then eases down each time the clock moves on. */}
        <motion.circle className="mg-heat-ring-fill" cx="14" cy="14" r={R} strokeDasharray={LENGTH} transform="rotate(-90 14 14)"
          initial={still ? false : { strokeDashoffset: LENGTH }} animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />
      </svg>
      <span className="mg-heat-ring-text" aria-hidden="true">{state.tone === 'live' ? 'On' : state.tone === 'due' ? 'Due' : state.minutes}</span>
    </span>
  );
}
