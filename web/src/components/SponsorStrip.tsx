import { useRecordSponsorViews, useSponsorsFor } from '../hooks/useSponsors';
import type { SponsorPlacementKey } from '../lib/sponsors';
import { SponsorBadge } from './SponsorBadge';

/**
 * The slot for a page: the sponsors set to show in `placement`, headline tier first and larger. It draws
 * nothing when there are none, and counts one view per sponsor each time it appears.
 */
export function SponsorStrip({ placement, title = 'Our sponsors' }: { placement: SponsorPlacementKey; title?: string }) {
  const sponsors = useSponsorsFor(placement);
  useRecordSponsorViews(placement, sponsors);
  if (sponsors.length === 0) return null;
  return (
    <section className="mg-sponsors" aria-label={title}>
      <h2 className="mg-sponsors-title">{title}</h2>
      <ul>
        {sponsors.map((sponsor) => <li key={sponsor.id}><SponsorBadge sponsor={sponsor} large={sponsor.tier === 0} /></li>)}
      </ul>
    </section>
  );
}
