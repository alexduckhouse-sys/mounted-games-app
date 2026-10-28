import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Notice } from '../../components/Notice';
import { useStatsProfile } from '../../hooks/useStats';
import { statsFacts } from '../../lib/stats';
import '../../components/sitePages.css';

/**
 * Race figures over the event teams linked to a team profile: three headline numbers as a plain list, then a row that
 * opens all the figures (`/team-profiles/:id/stats`: the games and their runs). The API sends them to everyone for a
 * team profile, so nothing here depends on signing in. Hidden while there's nothing linked.
 */
export function TeamGameStats({ profileId, linked }: { profileId: string; linked: number }) {
  const { user } = useAuth();
  const load = useStatsProfile(linked > 0 ? `/stats/team-profiles/${profileId}` : null, user?.id ?? 'public');
  if (linked === 0 || load.status === 'idle' || load.status === 'missing') return null;
  if (load.status === 'loading') return <p role="status" className="sp-note">Loading race statistics…</p>;
  if (load.status === 'error') return <Notice>{load.message}</Notice>;
  return <>
    <h2 className="sp-sec">Race statistics</h2>
    <div className="sp-card">
      <dl className="sp-facts" aria-label="Race statistics">
        {statsFacts(load.data.summary).slice(0, 3).map((fact) => (
          <div key={fact.label} className="sp-fact"><dt>{fact.label}</dt><dd>{fact.value}</dd></div>
        ))}
      </dl>
      <Link to={`/team-profiles/${profileId}/stats`} state={{ mgTransition: 'push' }} className="sp-row font-bold text-[rgb(var(--mg-heading))]">
        <span className="sp-grow"><span className="sp-t1 !text-[rgb(var(--mg-heading))] !font-bold">See all stats</span></span>
        <ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} />
      </Link>
    </div>
  </>;
}
