import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { formatPoints } from '../lib/formatPoints';
import { useStillMotion } from '../lite/useStillMotion';

const roll = {
  enter: (up: boolean) => ({ y: up ? '100%' : '-100%', opacity: 0 }),
  shown: { y: '0%', opacity: 1 },
  leave: (up: boolean) => ({ y: up ? '-100%' : '100%', opacity: 0 }),
};

/**
 * Points that roll to their new value like a departures board: each character that changes slides out and the new
 * one slides in (up when the points go up), units first. Only the current value is in the page between changes.
 */
export function TickerNumber({ value, format = formatPoints }: { value: number; format?: (value: number) => string }) {
  const still = useStillMotion();
  const [last, setLast] = useState({ value, up: true });
  if (last.value !== value) setLast({ value, up: value > last.value });
  const up = last.value === value ? last.up : value > last.value;
  const text = format(value);
  if (still) return <>{text}</>;
  const chars = [...text];
  return <>{chars.map((char, index) => {
    // Columns are counted from the right, so the units stay the units when a ten appears.
    const column = chars.length - index;
    return (
      <span key={column} className="mg-ticker-col">
        <AnimatePresence initial={false} mode="popLayout" custom={up}>
          <motion.span
            key={char}
            className="mg-ticker-char"
            custom={up}
            variants={roll}
            initial="enter"
            animate="shown"
            exit="leave"
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1], delay: (column - 1) * 0.06 }}
          >
            {char}
          </motion.span>
        </AnimatePresence>
      </span>
    );
  })}</>;
}
