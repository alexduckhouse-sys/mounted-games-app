import type { CSSProperties } from 'react';
import { motion } from 'framer-motion';

/**
 * The soft pill behind the current tab's icon. It stays mounted and slides from column to column, so changing tab
 * glides rather than jumps. Put it first inside the tab grid; `index` is -1 when no tab is current.
 */
export function TabMark({ index, count, compact = false }: { index: number; count: number; compact?: boolean }) {
  return (
    <span className="mg-tab-track" style={{ '--mg-tab-count': count } as CSSProperties} aria-hidden="true">
      <motion.span
        className={`mg-tab-mark${compact ? ' mg-tab-mark-compact' : ''}`}
        initial={false}
        animate={{ x: `${Math.max(index, 0) * 100}%`, opacity: index < 0 ? 0 : 1 }}
        transition={{ type: 'spring', stiffness: 520, damping: 40 }}
      />
    </span>
  );
}
