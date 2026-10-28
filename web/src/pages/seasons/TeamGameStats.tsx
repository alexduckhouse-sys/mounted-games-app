import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Notice } from '../../components/Notice';
import { useStatsProfile } from '../../hooks/useStats';
import { statsFacts } from '../../lib/stats';
import { useT } from '../../i18n/LanguageContext';
import '../../components/sitePages.css';

/**
 * Race figures over the event teams linked to a team profile: three headline numbers as a plain list, then a row that
 * opens all the figures (`/team-profiles/:id/stats`: the games and their runs). The API sends them to everyone for a
 * team profile, so nothing here depends on signing in. Hidden while there's nothing linked.
 */
export function TeamGameStats({ profileId, linked, season }: { profileId: string; linked: number; season?: string | null }) {
  const t = useT();
  const { user } = useAuth();
  const load = useStatsProfile(linked > 0 ? `/stats/team-profiles/${profileId}` : null, user?.id ?? 'public');
  if (linked === 0 || load.status === 'idle' || load.status === 'missing') return null;
  if (load.status === 'loading') return <p role="status" className="sp-note">{t('site.stats.loadingRace')}</p>;
  if (load.status === 'error') return <Notice>{load.message}</Notice>;
  return <>
    <h2 className="sp-sec">{t('site.stats.raceStatistics')}</h2>
    <div className="sp-card">
      <dl className="sp-facts" aria-label={t('site.stats.raceStatistics')}>
        {statsFacts(load.data.summary).slice(0, 3).map((fact) => (
          <div key={fact.label} className="sp-fact"><dt>{fact.label}</dt><dd>{fact.value}</dd></div>
        ))}
      </dl>
      <Link to={`/team-profiles/${profileId}/stats${season ? `?season=${encodeURIComponent(season)}` : ''}`} state={{ mgTransition: 'push' }} className="sp-row font-bold text-[rgb(var(--mg-heading))]">
        <span className="sp-grow"><span className="sp-t1 !text-[rgb(var(--mg-heading))] !font-bold">{t('site.stats.seeAll')}</span></span>
        <ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} />
      </Link>
    </div>
  </>;
}
