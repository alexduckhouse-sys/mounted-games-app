/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { EASE_IN, EASE_OUT } from '../../lib/motion';
import { useStillMotion } from '../../lite/useStillMotion';
import { useT } from '../../i18n/LanguageContext';

/** How long the band covers the screen between the swap and the reveal. */
export const WIPE_HOLD_MS = 160;
const SWEEP_S = 0.36;

export interface WipeCard {
  /** "Replay" going into a clip, "Live" coming back. */
  title: 'Replay' | 'Live';
  /** The clip name, shown under the title. */
  detail?: string;
}

interface Running extends WipeCard {
  id: number;
}

/**
 * The diagonal band that covers the switch between live video and a replay, or from one clip to the next.
 * `wipe(card, swap)` sweeps the band across, runs `swap` while the screen is covered, then sweeps it off.
 * With reduced motion or lite mode the swap simply happens. Render `layer` once, anywhere: it portals to the body
 * (or the full-screen element).
 * `accent` and `ink` are the event look's accent and background colours.
 */
export function useReplayWipe(accent?: string, ink?: string): { wipe: (card: WipeCard, swap: () => void) => void; layer: ReactNode } {
  const still = useStillMotion();
  const [running, setRunning] = useState<Running | null>(null);
  const pending = useRef<(() => void) | null>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useRef(0);

  useEffect(() => () => {
    if (hold.current) clearTimeout(hold.current);
    if (fallback.current) clearTimeout(fallback.current);
  }, []);

  const covered = useCallback(() => {
    if (fallback.current) clearTimeout(fallback.current);
    const swap = pending.current;
    pending.current = null;
    swap?.();
    if (hold.current) clearTimeout(hold.current);
    hold.current = setTimeout(() => setRunning(null), WIPE_HOLD_MS);
  }, []);

  const wipe = useCallback((card: WipeCard, swap: () => void) => {
    if (still) { swap(); return; }
    // A second wipe before the first one covered: do the earlier swap now so nothing is lost.
    pending.current?.();
    pending.current = swap;
    if (hold.current) clearTimeout(hold.current);
    // The swap must happen even if the sweep never reports back (a frame loop paused in a hidden tab).
    if (fallback.current) clearTimeout(fallback.current);
    fallback.current = setTimeout(covered, SWEEP_S * 1000 + 400);
    nextId.current += 1;
    setRunning({ ...card, id: nextId.current });
  }, [still, covered]);

  // In real full screen only the full-screen element is drawn, so the band goes inside it.
  const layer = createPortal(
    <AnimatePresence>
      {running && <WipeBand key={running.id} card={running} accent={accent} ink={ink} onCovered={covered} />}
    </AnimatePresence>,
    document.fullscreenElement ?? document.body,
  );
  return { wipe, layer };
}

function WipeBand({ card, accent = '#F5B82E', ink = '#0F1E3D', onCovered }: { card: WipeCard; accent?: string; ink?: string; onCovered: () => void }) {
  const t = useT();
  return (
    <div className="mg-wipe" aria-hidden="true">
      <motion.div
        className="mg-wipe-band"
        style={{ skewX: -14, '--wipe-accent': accent, '--wipe-ink': ink } as CSSProperties}
        initial={{ x: '-105%' }}
        animate={{ x: '0%', transition: { duration: SWEEP_S, ease: EASE_IN } }}
        exit={{ x: '105%', transition: { duration: SWEEP_S, ease: EASE_OUT } }}
        onAnimationComplete={(definition) => { if ((definition as { x?: string }).x === '0%') onCovered(); }}
      >
        <span className="mg-wipe-lead" />
        <span className="mg-wipe-body">
          <motion.span
            className="mg-wipe-words"
            style={{ skewX: 14 }}
            initial={{ opacity: 0, x: '-12%' }}
            animate={{ opacity: 1, x: '0%' }}
            transition={{ duration: 0.3, delay: SWEEP_S * 0.6, ease: EASE_OUT }}
          >
            <strong>{card.title === 'Live' && <i className="mg-wipe-dot" />}{t(card.title === 'Live' ? 'screen.wipe.live' : 'screen.wipe.replay')}</strong>
            {card.detail && <small>{card.detail}</small>}
          </motion.span>
        </span>
        <span className="mg-wipe-trail" />
      </motion.div>
    </div>
  );
}
