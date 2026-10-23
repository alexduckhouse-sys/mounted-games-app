import { useCompetition } from './context';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { SponsorBadge } from '../../components/SponsorBadge';
import { RefineSection } from '../refine/Refine';
import { useRecordSponsorViews, useSponsorsFor } from '../../hooks/useSponsors';
import { groupByTier } from '../../lib/sponsors';
import { usePageWidth } from '../../components/pageWidthState';

/** The public sponsor page: every sponsor set to show here, by tier, headline first. */
export function SponsorsPage() {
  usePageWidth('wide');
  const { competition } = useCompetition();
  const sponsors = useSponsorsFor('SponsorPage');
  useRecordSponsorViews('SponsorPage', sponsors);
  usePageHeader({ title: 'Sponsors', subtitle: competition.name });
  const groups = groupByTier(sponsors);

  return (
    <div className="rf-page mx-auto flex w-full max-w-3xl flex-col gap-2.5 pb-4 pt-3 lg:max-w-none">
      <h1 className="sr-only">Sponsors</h1>
      {groups.length === 0 && <p className="mg-card p-4 text-[rgb(var(--mg-muted))]">No sponsors to show yet.</p>}
      {groups.map((group) => (
        <section key={group.tier} aria-label={group.label}>
          <RefineSection title={group.label} />
          <ul className="mg-sponsor-card-list mg-cards-grid">
            {group.sponsors.map((sponsor) => (
              <li key={sponsor.id} className="mg-card"><SponsorBadge sponsor={sponsor} large={group.tier === 0} /></li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
