/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { EASE_IN, EASE_OUT } from '../../lib/motion';
import { useStillMotion } from '../../lite/useStillMotion';
import { useT } from '../../i18n/LanguageContext';
import { useOverlay } from '../../hooks/useOverlay';
import { useSponsors } from '../../hooks/useSponsors';
import { recordSponsorView } from '../../lib/sponsorExposure';
import { logoSrc, sponsorsFor } from '../../lib/sponsors';
import { LazyImage } from '../LazyImage';
import type { Sponsor } from '../../types';

/** How long the band covers the screen between the swap and the reveal. */
export const WIPE_HOLD_MS = 160;
const SWEEP_S = 0.36;
/** How long the sponsor's logo holds on the covered screen before a replay starts. */
export const SPONSOR_HOLD_MS = 1400;

export interface WipeCard {
  /** "Replay" going into a clip, "Live" coming back. */
  title: 'Replay' | 'Live';
  /** The clip name, shown under the title. */
  detail?: string;
}

interface Running extends WipeCard {
  id: number;
  /** The sponsor shown before this replay, if there is one. */
  sponsor?: Sponsor;
}

/**
 * The diagonal band that covers the switch between live video and a replay, or from one clip to the next.
 * `wipe(card, swap)` sweeps the band across, runs `swap` while the screen is covered, then sweeps it off.
 * With reduced motion or lite mode the swap simply happens. Render `layer` once, anywhere: it portals to the body
 * (or the full-screen element).
 * `accent` and `ink` are the event look's accent and background colours.
 * With `sponsor` on (the viewers' player), a "Replay" wipe holds a little longer and shows one sponsor's logo first,
 * taking turns through the sponsors that have the "Before replays" place, unless the producer has switched sponsors
 * off. The replay starts as the band lifts. Reduced motion and lite mode never show it.
 */
export function useReplayWipe(accent?: string, ink?: string, options: { sponsor?: boolean } = {}): { wipe: (card: WipeCard, swap: () => void) => void; layer: ReactNode } {
  const still = useStillMotion();
  const { competitionId, sponsors } = useSponsors();
  const { overlay } = useOverlay();
  const showSponsors = Boolean(options.sponsor) && overlay.sponsorMode !== 2;
  // Sponsors only exist inside a competition page, so there is always a competition to count their views against.
  const eligible = useMemo(
    () => (showSponsors && competitionId !== null ? sponsorsFor(sponsors, 'Replays').map((sponsor) => ({ sponsor, competitionId })) : []),
    [showSponsors, sponsors, competitionId],
  );
  const turn = useRef(0);
  const bumper = useRef(false);
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
    if (hold.current) clearTimeout(hold.current);
    const finish = () => {
      const swap = pending.current;
      pending.current = null;
      swap?.();
      hold.current = setTimeout(() => setRunning(null), WIPE_HOLD_MS);
    };
    // A sponsor's logo holds on the covered screen first, so the replay's own start is not hidden behind it.
    if (bumper.current) hold.current = setTimeout(finish, SPONSOR_HOLD_MS);
    else finish();
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
    const next = card.title === 'Replay' && eligible.length > 0 ? eligible[turn.current % eligible.length] : undefined;
    bumper.current = next !== undefined;
    if (next) {
      turn.current += 1;
      recordSponsorView(next.competitionId, next.sponsor.id, 'Replays');
    }
    setRunning({ ...card, id: nextId.current, sponsor: next?.sponsor });
  }, [still, covered, eligible]);

  // In real full screen only the full-screen element is drawn, so the band goes inside it.
  const layer = createPortal(
    <AnimatePresence>
      {running && <WipeBand key={running.id} card={running} accent={accent} ink={ink} onCovered={covered} />}
    </AnimatePresence>,
    document.fullscreenElement ?? document.body,
  );
  return { wipe, layer };
}

function WipeBand({ card, accent = '#F5B82E', ink = '#0F1E3D', onCovered }: { card: Running; accent?: string; ink?: string; onCovered: () => void }) {
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
          {card.sponsor ? <SponsorWords sponsor={card.sponsor} /> : <motion.span
            className="mg-wipe-words"
            style={{ skewX: 14 }}
            initial={{ opacity: 0, x: '-12%' }}
            animate={{ opacity: 1, x: '0%' }}
            transition={{ duration: 0.3, delay: SWEEP_S * 0.6, ease: EASE_OUT }}
          >
            <strong>{card.title === 'Live' && <i className="mg-wipe-dot" />}{t(card.title === 'Live' ? 'screen.wipe.live' : 'screen.wipe.replay')}</strong>
            {card.detail && <small>{card.detail}</small>}
          </motion.span>}
        </span>
        <span className="mg-wipe-trail" />
      </motion.div>
    </div>
  );
}

/** "Replay brought to you by" and the sponsor's logo, or its name when it has no logo or the logo will not load. */
function SponsorWords({ sponsor }: { sponsor: Sponsor }) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  const src = sponsor.logoUrl ? logoSrc(sponsor.logoUrl, import.meta.env.VITE_API_BASE) : null;
  return (
    <motion.span
      className="mg-wipe-words"
      style={{ skewX: 14 }}
      initial={{ opacity: 0, x: '-12%' }}
      animate={{ opacity: 1, x: '0%' }}
      transition={{ duration: 0.3, delay: SWEEP_S * 0.6, ease: EASE_OUT }}
    >
      <small>{t('screen.wipe.sponsor')}</small>
      {src && !failed
        ? <LazyImage src={src} alt={sponsor.name} className="mg-wipe-logo" onFailed={() => setFailed(true)} />
        : <strong className="mg-wipe-sponsor-name">{sponsor.name}</strong>}
    </motion.span>
  );
}
