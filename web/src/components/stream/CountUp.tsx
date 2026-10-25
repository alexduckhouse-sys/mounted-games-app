import { useEffect, useState } from 'react';
import { animate } from 'framer-motion';
import { countStep, EASE_OUT } from '../../lib/motion';
import { useStillMotion } from '../../lite/useStillMotion';

/**
 * A number that counts from its old value to its new one: points in whole or half points by default, or any steps
 * `round` gives (Math.round for pence). Still when motion is reduced.
 */
export function CountUp({ from, to, delay = 0, duration = 0.55, format, round }: {
  from: number; to: number; delay?: number; duration?: number; format: (value: number) => string; round?: (value: number) => number;
}) {
  const still = useStillMotion() || from === to;
  const [value, setValue] = useState(from);
  useEffect(() => {
    if (still) return;
    const controls = animate(0, 1, { delay, duration, ease: EASE_OUT, onUpdate: (progress) => setValue(round && progress < 1 ? round(from + (to - from) * progress) : countStep(from, to, progress)) });
    return () => controls.stop();
  }, [still, from, to, delay, duration, round]);
  return <>{format(still ? to : value)}</>;
}
