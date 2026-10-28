import { useContext, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CompetitionContext } from '../../pages/competition/context';
import { confettiBurst } from '../bursts';
import { Rosette } from '../Rosette';
import { CountUp } from './CountUp';
import { DIAGONAL_HIDDEN_LEFT, DIAGONAL_HIDDEN_RIGHT, DIAGONAL_SHOWN, ENTER, EASE_OUT, LEAVE } from '../../lib/motion';
import { ordinal } from '../../lib/toplist';
import type { PrizeGiving, PrizeGivingPlace } from '../../lib/prizeGiving';
import { useStillMotion } from '../../lite/useStillMotion';

const points = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

/**
 * The prize-giving on the live video, as the organiser steps through it: the place just read out in a lower third
 * (in on the gold diagonal wipe, its points counting up), the places already given in a card down the right like the
 * score card, and for the winners a centred card with the rosette and confetti.
 */
export function PrizeGivingOverlay({ auto = null }: { auto?: PrizeGiving | null }) {
  // The organiser's own stepping wins over the one that plays itself after a final.
  const prizeGiving = useContext(CompetitionContext)?.prizeGiving ?? auto;
  return <AnimatePresence>{prizeGiving && <PrizeGivingShown key={prizeGiving.sectionId} prizeGiving={prizeGiving} />}</AnimatePresence>;
}

function PrizeGivingShown({ prizeGiving }: { prizeGiving: PrizeGiving }) {
  const still = useStillMotion();
  const { places, champions, sectionName } = prizeGiving;
  const current = places[places.length - 1];
  const given = (champions ? places : places.slice(0, -1)).slice().sort((a, b) => a.place - b.place);
  return (
    <motion.div className="absolute inset-0" initial={false} exit={still ? undefined : { opacity: 0, transition: LEAVE }}>
      <AnimatePresence>
        {!champions && given.length > 0 && (
          <motion.aside key="ladder" className="mg-pg-ladder" aria-label={`Prize-giving, ${sectionName}`}
            initial={still ? false : { opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={still ? undefined : { opacity: 0, transition: LEAVE }} transition={ENTER}>
            <header><b>Prize-giving</b><span>{sectionName}</span></header>
            <motion.span className="mg-pg-rule" initial={still ? false : { scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ ...ENTER, delay: 0.1 }} />
            <ol>
              {given.map((place) => (
                <motion.li key={place.teamId} layout={still ? false : 'position'}
                  initial={still ? false : { opacity: 0, y: -6, backgroundColor: 'rgba(245, 184, 46, 0.25)' }}
                  animate={{ opacity: 1, y: 0, backgroundColor: 'rgba(245, 184, 46, 0)' }} transition={{ duration: 0.6, ease: EASE_OUT }}>
                  <i>{ordinal(place.place)}</i><span>{place.teamName}</span><b>{points(place.points)}</b>
                </motion.li>
              ))}
            </ol>
          </motion.aside>
        )}
      </AnimatePresence>
      <AnimatePresence mode="wait">
        {champions
          ? <Champions key={`champions-${current.teamId}`} place={current} sectionName={sectionName} still={still} />
          : <LowerThird key={current.teamId} place={current} still={still} />}
      </AnimatePresence>
    </motion.div>
  );
}

function LowerThird({ place, still }: { place: PrizeGivingPlace; still: boolean }) {
  return (
    <motion.div className="mg-pg-lower" role="status" aria-label={`${ordinal(place.place)}: ${place.teamName}, ${points(place.points)} points`}
      initial={still ? false : { clipPath: DIAGONAL_HIDDEN_LEFT }} animate={{ clipPath: DIAGONAL_SHOWN }}
      exit={still ? undefined : { clipPath: DIAGONAL_HIDDEN_RIGHT, transition: LEAVE }} transition={{ ...ENTER, delay: 0.14 }}>
      {/* A gold band sweeps across ahead of the bar, like the replay wipe. */}
      {!still && <motion.span className="mg-pg-band" aria-hidden="true" initial={{ clipPath: DIAGONAL_HIDDEN_LEFT }}
        animate={{ clipPath: [DIAGONAL_HIDDEN_LEFT, DIAGONAL_SHOWN, DIAGONAL_HIDDEN_RIGHT] }} transition={{ duration: 0.64, ease: EASE_OUT }} />}
      <motion.span className="mg-pg-place" aria-hidden="true" initial={still ? false : { scale: 0.6 }} animate={{ scale: [0.6, 1.12, 1] }}
        transition={{ duration: 0.42, delay: 0.38 }}>{ordinal(place.place)}</motion.span>
      <span className="mg-pg-name" aria-hidden="true">
        <motion.b initial={still ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...ENTER, delay: 0.42 }}>{place.teamName}</motion.b>
        {place.clubName && <motion.span initial={still ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...ENTER, delay: 0.5 }}>{place.clubName}</motion.span>}
      </span>
      <span className="mg-pg-pts" aria-hidden="true">
        <CountUp from={Math.round(place.points * 0.6)} to={place.points} delay={0.45} duration={0.9} format={points} /><small>points</small>
      </span>
    </motion.div>
  );
}

function Champions({ place, sectionName, still }: { place: PrizeGivingPlace; sectionName: string; still: boolean }) {
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (still || !card.current) return;
    const target = card.current;
    const timer = setTimeout(() => confettiBurst(target, 40), 850);
    return () => clearTimeout(timer);
  }, [still]);
  const rise = (delay: number) => ({ initial: still ? false as const : { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { ...ENTER, delay } });
  return (
    <motion.div className="mg-pg-champ" role="status" aria-label={`${sectionName} champions: ${place.teamName}, ${points(place.points)} points`}
      initial={still ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={still ? undefined : { opacity: 0, transition: LEAVE }}>
      <motion.div ref={card} className="mg-pg-champ-card" initial={still ? false : { opacity: 0, y: 18, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 22 }}>
        <motion.span className="mg-pg-rosette" aria-hidden="true" initial={still ? false : { y: '-70%', rotate: -12, opacity: 0 }}
          animate={{ y: ['-70%', '4%', '0%'], rotate: [-12, 5, 0], opacity: [0, 1, 1] }} transition={{ duration: 1.1, delay: 0.25, ease: 'easeOut' }}>
          <Rosette width={64} />
        </motion.span>
        <motion.span className="mg-pg-kicker" aria-hidden="true" {...rise(0.65)}>{sectionName} champions</motion.span>
        <motion.b className="mg-pg-champ-name" aria-hidden="true" {...rise(0.8)}>{place.teamName}</motion.b>
        <motion.span className="mg-pg-champ-sub" aria-hidden="true" {...rise(0.95)}>{[place.clubName, `${points(place.points)} points`].filter(Boolean).join(' · ')}</motion.span>
      </motion.div>
    </motion.div>
  );
}
