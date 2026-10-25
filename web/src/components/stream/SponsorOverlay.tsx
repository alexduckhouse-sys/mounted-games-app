import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useOverlay } from '../../hooks/useOverlay';
import { useSponsorRotation } from '../../hooks/useSponsorRotation';
import { useSponsors } from '../../hooks/useSponsors';
import { recordSponsorSeconds, recordSponsorView } from '../../lib/sponsorExposure';
import { BREAK_CARD_MS, onBreak, SPONSOR_TIERS, sponsorsFor, STREAM_LOGO_MS } from '../../lib/sponsors';
import { SponsorBadge } from '../SponsorBadge';
import { LEAVE, SPRING } from '../../lib/motion';
import { useStillMotion } from '../../lite/useStillMotion';

/**
 * Sponsors over the live video. During a break or briefing in this arena, cards (logo and name) rotate in the
 * lower third, headline tier first. At other times a small logo rotates in the corner. The producer's switch
 * (`overlay.sponsorMode`) turns this off, or forces the cards on, and "skip" moves to the next sponsor.
 * `track` is false for previews, which must not add to the counts.
 */
export function SponsorOverlay({ arenaName, track = true }: { arenaName: string; track?: boolean }) {
  const still = useStillMotion();
  const { overlay } = useOverlay();
  const { competitionId, sponsors, sessions, skip } = useSponsors();
  const cards = sponsorsFor(sponsors, 'BreakStream');
  const logos = sponsorsFor(sponsors, 'Stream');
  const mode = overlay.sponsorMode;
  const cardsOn = mode !== 2 && cards.length > 0 && (mode === 1 || onBreak(sessions, arenaName));
  const logosOn = mode !== 2 && !cardsOn && logos.length > 0;
  const list = cardsOn ? cards : logosOn ? logos : [];
  const placement = cardsOn ? 'BreakStream' : 'Stream';
  const index = useSponsorRotation(list.length, cardsOn ? BREAK_CARD_MS : STREAM_LOGO_MS, skip);
  const sponsor = list[index] ?? null;
  const shownId = sponsor?.id ?? null;

  // Count each appearance, and the seconds it stays while this tab is in view.
  useEffect(() => {
    if (!track || competitionId === null || shownId === null) return;
    recordSponsorView(competitionId, shownId, placement);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') recordSponsorSeconds(competitionId, shownId, placement, 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [track, competitionId, shownId, placement]);

  const tier = sponsor ? SPONSOR_TIERS.find((t) => t.tier === sponsor.tier)!.label : '';
  // One sponsor hands over to the next: the old card drops away before the new one lifts in.
  return (
    <AnimatePresence mode="wait">
      {sponsor && cardsOn && (
        <motion.div
          key={`card-${sponsor.id}`}
          className="absolute inset-x-3 bottom-14 flex justify-center"
          initial={still ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={still ? undefined : { opacity: 0, y: 8, transition: LEAVE }}
          transition={SPRING}
        >
          <aside className="mg-ov-sponsor-card pointer-events-auto" aria-label={`${tier} sponsor`}>
            <span className="mg-ov-sponsor-tier">{tier === 'Supporter' ? tier : `${tier} sponsor`}</span>
            <motion.div
              initial={still ? false : { y: 8, scale: 0.98 }}
              animate={{ y: 0, scale: 1 }}
              transition={{ ...SPRING, delay: 0.08 }}
            >
              <SponsorBadge sponsor={sponsor} large />
            </motion.div>
          </aside>
        </motion.div>
      )}
      {sponsor && !cardsOn && (
        <motion.aside
          key={`bug-${sponsor.id}`}
          className="mg-ov-sponsor-bug pointer-events-auto absolute bottom-14 right-3"
          aria-label="Sponsor"
          initial={still ? false : { opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={still ? undefined : { opacity: 0, scale: 0.96, transition: LEAVE }}
          transition={SPRING}
        >
          <SponsorBadge sponsor={sponsor} />
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
