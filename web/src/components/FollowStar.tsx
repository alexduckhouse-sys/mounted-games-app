import { useState } from 'react';
import { motion } from 'framer-motion';
import { Star } from 'lucide-react';
import { useStillMotion } from '../lite/useStillMotion';

const RAYS = [0, 60, 120, 180, 240, 300];

/** The follow star. Following a team makes it pop and throw a little ring of sparks; unfollowing just empties it. */
export function FollowStar({ on, className = 'h-5 w-5' }: { on: boolean; className?: string }) {
  const still = useStillMotion();
  const [seen, setSeen] = useState({ on, pops: 0 });
  if (seen.on !== on) setSeen({ on, pops: on ? seen.pops + 1 : seen.pops });
  const pops = seen.on === on ? seen.pops : seen.pops + (on ? 1 : 0);
  const popping = pops > 0 && on && !still;
  return (
    <span className="mg-follow-star">
      <motion.span
        // A new key for each follow plays the pop again.
        key={pops}
        className="inline-flex"
        initial={popping ? { scale: 0.3, rotate: -40 } : false}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 520, damping: 13 }}
      >
        <Star aria-hidden="true" className={`${className} ${on ? 'fill-current' : ''}`} />
      </motion.span>
      {popping && (
        <span key={`burst-${pops}`} className="mg-follow-burst" aria-hidden="true">
          {RAYS.map((angle) => <i key={angle} style={{ rotate: `${angle}deg` }} />)}
        </span>
      )}
    </span>
  );
}
