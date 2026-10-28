import { useMemo } from 'react';
import { useT } from '../../i18n/LanguageContext';
import { groupByTier } from '../../lib/sponsors';
import { SponsorBadge } from '../../components/SponsorBadge';
import { useRecordSponsorViews, useSponsorsFor } from '../../hooks/useSponsors';

/** Public sponsors shown directly on the Details tab, grouped by tier (headline first). */
export function EventSponsorsSection() {
  const t = useT();
  const tierLabel = (tier: number) => t(tier === 0 ? 'site.sponsors.headline' : tier === 1 ? 'site.sponsors.major' : 'site.sponsors.supporter');
  const detailsSponsors = useSponsorsFor('Details');
  const pageSponsors = useSponsorsFor('SponsorPage');
  useRecordSponsorViews('Details', detailsSponsors);
  const groups = useMemo(() => {
    const seen = new Set<number>();
    const combined = [...detailsSponsors, ...pageSponsors].filter((sponsor) => {
      if (seen.has(sponsor.id)) return false;
      seen.add(sponsor.id);
      return true;
    });
    return groupByTier(combined);
  }, [detailsSponsors, pageSponsors]);

  if (groups.length === 0) return null;
  return (
    <section className="mg-sponsors" aria-label={t('site.sponsors.title')}>
      <h2 className="mg-sponsors-title">{t('site.sponsors.title')}</h2>
      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <div key={group.tier} role="group" aria-label={tierLabel(group.tier)}>
            <h3 className="mb-1.5 text-xs font-bold uppercase tracking-[0.08em] text-[rgb(var(--mg-muted))]">{tierLabel(group.tier)}</h3>
            <ul className="mg-sponsor-card-list mg-cards-grid">
              {group.sponsors.map((sponsor) => (
                <li key={sponsor.id} className="mg-card"><SponsorBadge sponsor={sponsor} large={group.tier === 0} /></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
