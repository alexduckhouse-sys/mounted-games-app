import { AnimatePresence, motion } from 'framer-motion';
import { RotateCw, WifiOff } from 'lucide-react';
import { useT } from '../i18n/LanguageContext';
import type { RefreshFeedback, RefreshPhase } from '../hooks/useRefreshFeedback';

type Translate = ReturnType<typeof useT>;

function statusLabel(t: Translate, phase: RefreshPhase): string | null {
  switch (phase) {
    case 'loading': return t('shell.refresh.loading');
    case 'updated': return t('shell.refresh.updated');
    case 'same': return t('shell.refresh.same');
    case 'offline': return t('shell.refresh.offline');
    case 'failed': return t('shell.refresh.failed');
    default: return null;
  }
}

const swap = { duration: 0.16, ease: 'easeOut' } as const;
const pop = { type: 'spring', stiffness: 520, damping: 20 } as const;
const leave = { opacity: 0, scale: 0.5, transition: swap };

/** A tick drawn on, with a ring that spreads out behind it. */
function Tick() {
  return (
    <motion.span key="tick" className="mg-refresh-layer" initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} exit={leave} transition={pop}>
      <motion.span className="mg-refresh-ring" initial={{ opacity: 0.55, scale: 0.5 }} animate={{ opacity: 0, scale: 2 }} transition={{ duration: 0.6, ease: 'easeOut' }} />
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round">
        <motion.path d="M20 6 9 17l-5-5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.3, ease: 'easeOut', delay: 0.05 }} />
      </svg>
    </motion.span>
  );
}

/** A cross drawn on with a small shake: the server didn't answer. */
function Cross() {
  return (
    <motion.span key="cross" className="mg-refresh-layer" initial={{ opacity: 0 }} animate={{ opacity: 1, x: [0, -3, 3, -2, 2, 0] }} exit={leave} transition={{ opacity: swap, x: { duration: 0.4, delay: 0.12 } }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.75} strokeLinecap="round">
        <motion.path d="M18 6 6 18" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.18, ease: 'easeOut' }} />
        <motion.path d="m6 6 12 12" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.18, ease: 'easeOut', delay: 0.1 }} />
      </svg>
    </motion.span>
  );
}

/**
 * A refresh button that shows the refresh happening: the arrow turns until the page has its answer, then turns into
 * a tick (updated or already up to date), a no-signal icon or a cross, and back into the arrow.
 * Screen readers hear the same words the header shows.
 */
export function RefreshButton({ feedback, label, className = 'mg-hdr-icon mg-hdr-icon-sub' }: { feedback: RefreshFeedback; label: string; className?: string }) {
  const t = useT();
  const { phase, tap } = feedback;
  const shape = phase === 'updated' || phase === 'same' ? 'tick' : phase === 'offline' || phase === 'failed' ? phase : 'arrow';
  return (
    <>
      <button type="button" onClick={tap} className={`${className} mg-refresh`} data-phase={phase} aria-label={label} aria-busy={phase === 'loading' || undefined}>
        <span className="mg-refresh-icon" aria-hidden="true">
          <AnimatePresence initial={false}>
            {shape === 'arrow' && (
              <motion.span key="arrow" className="mg-refresh-layer" initial={{ opacity: 0, scale: 0.6, rotate: -120 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} exit={leave} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
                <RotateCw className={phase === 'loading' ? 'mg-refresh-spin' : undefined} />
              </motion.span>
            )}
            {shape === 'tick' && <Tick />}
            {shape === 'offline' && (
              <motion.span key="offline" className="mg-refresh-layer" initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={leave} transition={pop}>
                <WifiOff />
              </motion.span>
            )}
            {shape === 'failed' && <Cross />}
          </AnimatePresence>
        </span>
      </button>
      <span className="sr-only" role="status">{statusLabel(t, phase) ?? ''}</span>
    </>
  );
}

/**
 * The end of the header's subtitle: the page's own tail (the time it was updated) or, while a refresh shows, what it is
 * doing. Each change slides up into place.
 */
export function RefreshTail({ phase, tail }: { phase: RefreshPhase; tail?: string }) {
  const t = useT();
  const status = statusLabel(t, phase);
  const text = status ?? tail;
  return (
    <AnimatePresence initial={false} mode="wait">
      {text && (
        <motion.span
          key={status ? phase : 'tail'}
          className={`shrink-0 tabular-nums${status ? ' mg-refresh-status' : ''}`}
          data-phase={status ? phase : undefined}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -5 }}
          transition={swap}
        >
          · {text}
        </motion.span>
      )}
    </AnimatePresence>
  );
}
