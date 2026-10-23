import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { StatsGamesView } from '../../components/stats/StatsGamesView';
import { StatsSummaryView } from '../../components/stats/StatsSummaryView';
import { useStatsProfile } from '../../hooks/useStats';
import { RefineNote, RefineSection } from '../refine/Refine';

/**
 * Race and game figures over the event teams linked to a team profile. Everyone sees the summary; the
 * per-game table needs a signed-in viewer (the API leaves it out otherwise). Hidden while there's nothing linked.
 */
export function TeamGameStats({ profileId, linked }: { profileId: string; linked: number }) {
  const { user } = useAuth();
  const location = useLocation();
  const load = useStatsProfile(linked > 0 ? `/stats/team-profiles/${profileId}` : null, user?.id ?? 'public');
  if (linked === 0 || load.status === 'idle' || load.status === 'missing') return null;
  return <>
    <RefineSection title="Race statistics" />
    {load.status === 'loading' && <p role="status" className="rf-note">Loading race statistics…</p>}
    {load.status === 'error' && <p role="alert" className="rf-note">{load.message}</p>}
    {load.status === 'ready' && <>
      <StatsSummaryView summary={load.data.summary} raceFiguresAllFormats />
      {load.data.detailed
        ? <div className="pt-3"><StatsGamesView games={load.data.games ?? []} best={load.data.bestGames ?? []} worst={load.data.worstGames ?? []} /></div>
        : <RefineNote><Link to="/login" state={{ from: location.pathname + location.search }}>Sign in</Link> to see the figures for each game.</RefineNote>}
    </>}
  </>;
}
