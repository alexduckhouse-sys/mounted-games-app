import { useAuth } from '../../auth/AuthContext';
import { Notice } from '../../components/Notice';
import { useStatsProfile } from '../../hooks/useStats';
import { formatPercent, gameLine, statsFacts } from '../../lib/stats';
import '../../components/sitePages.css';

/**
 * Race figures over the event teams linked to a team profile: the headline numbers as a plain list, then each game
 * with its races, wins and averages and the point quota on the right. The API sends both to everyone for a team
 * profile, so nothing here depends on signing in. Hidden while there's nothing linked.
 */
export function TeamGameStats({ profileId, linked }: { profileId: string; linked: number }) {
  const { user } = useAuth();
  const load = useStatsProfile(linked > 0 ? `/stats/team-profiles/${profileId}` : null, user?.id ?? 'public');
  if (linked === 0 || load.status === 'idle' || load.status === 'missing') return null;
  if (load.status === 'loading') return <p role="status" className="sp-note">Loading race statistics…</p>;
  if (load.status === 'error') return <Notice>{load.message}</Notice>;
  const games = load.data.games ?? [];
  return <>
    <h2 className="sp-sec">Race statistics</h2>
    <dl className="sp-card sp-facts" aria-label="Race statistics">
      {statsFacts(load.data.summary).map((fact) => (
        <div key={fact.label} className="sp-fact"><dt>{fact.label}</dt><dd>{fact.value}</dd></div>
      ))}
    </dl>
    {games.length > 0 && <>
      <h2 className="sp-sec">By game</h2>
      <ul className="sp-card m-0 list-none p-0" aria-label="By game">
        {games.map((game) => (
          <li key={game.name} className="sp-row">
            <span className="sp-grow"><span className="sp-t1">{game.name}</span><span className="sp-t2">{gameLine(game)}</span></span>
            <span className="sp-quota" title="Point quota">{formatPercent(game.pointQuotaPercent)}</span>
          </li>
        ))}
      </ul>
    </>}
  </>;
}
