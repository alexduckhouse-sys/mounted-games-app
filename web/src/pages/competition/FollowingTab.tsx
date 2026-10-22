import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Star } from 'lucide-react';
import { useFavourites } from '../../hooks/useFavourites';
import { arenaNames, arenaToShow, followedHeats } from '../../lib/following';
import { displaySectionName } from '../../lib/section';
import { formatTime } from '../../lib/time';
import { dayKey, defaultTimetableDay } from '../../lib/timetableDay';
import { useCompetition } from './context';

export function FollowingTab() {
  const { competition, updatedAt, isStale, reload } = useCompetition();
  const { favourites, error, toggle, setMany } = useFavourites();
  const [search, setSearch] = useState('');
  const [showTeams, setShowTeams] = useState(false);
  const [selectedDay, setSelectedDay] = useState('');
  const ids = useMemo(() => new Set(favourites.filter((f) => f.competitionId === competition.id).map((f) => f.teamId)), [favourites, competition.id]);
  const teams = competition.teams.filter((team) => ids.has(team.id));
  const missing = [...ids].filter((id) => !competition.teams.some((team) => team.id === id));
  const rows = useMemo(() => followedHeats(competition, ids), [competition, ids]);
  const arenas = useMemo(() => arenaNames(competition.sessions), [competition.sessions]);
  const days = [...new Set(rows.flatMap((row) => row.effective ? [dayKey(row.effective)] : []))].sort();
  const day = days.includes(selectedDay) ? selectedDay : defaultTimetableDay(days, dayKey(new Date()));
  const today = rows.filter((row) => !row.effective || dayKey(row.effective) === day);
  const upcoming = today.filter((row) => row.status !== 'finished');
  const results = [...rows].reverse().filter((row) => row.scores.some((score) => score.racesRun > 0)).slice(0, 6);
  const query = search.trim().toLowerCase();
  const filtered = competition.teams.filter((team) => `${team.displayName} ${team.clubName} ${team.sectionName}`.toLowerCase().includes(query));
  const clubs = useMemo(() => {
    const byClub = new Map<number, { id: number; name: string; teamIds: number[] }>();
    for (const team of competition.teams) {
      const club = byClub.get(team.clubId) ?? { id: team.clubId, name: team.clubName, teamIds: [] };
      club.teamIds.push(team.id);
      byClub.set(team.clubId, club);
    }
    return [...byClub.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [competition.teams]);
  const shownClubs = clubs.filter((club) => filtered.some((team) => team.clubId === club.id));
  const followClub = (teamIds: number[], follow: boolean) => setMany(teamIds.map((teamId) => ({ competitionId: competition.id, teamId })), follow);

  return <div className="mx-auto max-w-2xl space-y-5 py-4">
    <div className="flex items-center justify-between gap-3">
      <h1 className="mg-h1 mg-h1-sm">Following</h1>
      <Link to="/following" className="mg-text-link text-sm">All my events</Link>
    </div>
    <p className="mg-meta">Stars are saved on this device. No sign-in needed.</p>
    {error && <p role="alert" className="mg-notice">{error}</p>}
    <div role="status" className={isStale ? 'mg-notice' : 'mg-meta'}>
      {isStale ? 'Showing the latest copy received. Times may have changed. ' : 'Updated '}
      {updatedAt ? updatedAt.toLocaleString('en-GB') : 'Time unavailable'}
      {isStale && <button className="mg-text-link ml-3 min-h-11" onClick={reload}>Refresh</button>}
    </div>

    <section aria-label="Starred teams" className="flex flex-wrap gap-2">
      {teams.map((team) => <button key={team.id} className="mg-chip !min-h-11 gap-2" aria-label={`Unfollow ${team.displayName}`} aria-pressed="true" onClick={() => toggle({ competitionId: competition.id, teamId: team.id })}>
        <Star className="h-4 w-4 fill-current" aria-hidden="true" />{team.displayName}<span className="text-xs opacity-80">{displaySectionName(team.sectionName)}</span>
      </button>)}
      <button className="mg-btn mg-btn-secondary" aria-expanded={showTeams || teams.length === 0} onClick={() => setShowTeams(!showTeams)}>{showTeams ? 'Close team picker' : 'Add teams'}</button>
    </section>
    {missing.map((teamId) => <p key={teamId} className="mg-notice">A followed team is no longer listed at this event. <button className="mg-text-link min-h-11" onClick={() => toggle({ competitionId: competition.id, teamId })}>Remove saved team</button></p>)}

    {(showTeams || teams.length === 0) && <section className="mg-card p-4 space-y-3" aria-label="Choose teams">
      {teams.length === 0 && <p>Star a team to see its next heats and results here.</p>}
      <label className="block font-semibold">Find a team<input type="search" className="input mt-1" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Team, club or age group" /></label>
      {!filtered.length && <p className="mg-meta">{competition.teams.length ? 'No teams match that search.' : 'Teams haven’t been added to this event yet.'}</p>}
      {shownClubs.length > 0 && <ul aria-label="Clubs" className="divide-y divide-[rgb(var(--mg-rule-soft))] rounded-lg border border-[rgb(var(--mg-rule-soft))] px-3">
        {shownClubs.map((club) => {
          const following = club.teamIds.every((id) => ids.has(id));
          return <li key={club.id} className="flex items-center gap-3 py-1">
            <div className="min-w-0 flex-1"><p className="font-semibold break-words">{club.name}</p><p className="mg-meta">{club.teamIds.length} {club.teamIds.length === 1 ? 'entry' : 'entries'}</p></div>
            <button className="mg-btn mg-btn-secondary !px-3" aria-pressed={following} aria-label={`${following ? 'Unfollow' : 'Follow'} club ${club.name}`} onClick={() => followClub(club.teamIds, !following)}>{following ? 'Unfollow club' : 'Follow club'}</button>
          </li>;
        })}
      </ul>}
      <ul className="max-h-80 divide-y divide-[rgb(var(--mg-rule-soft))] overflow-y-auto">
        {filtered.map((team) => <li key={team.id} className="flex items-center gap-3 py-1">
          <div className="min-w-0 flex-1"><p className="font-semibold break-words">{team.displayName}</p><p className="mg-meta">{displaySectionName(team.sectionName)}</p></div>
          <button className="mg-btn mg-btn-secondary !px-3" aria-pressed={ids.has(team.id)} aria-label={`${ids.has(team.id) ? 'Unfollow' : 'Follow'} ${team.displayName}`} onClick={() => toggle({ competitionId: competition.id, teamId: team.id })}><Star aria-hidden="true" className={`h-5 w-5 ${ids.has(team.id) ? 'fill-current' : ''}`} /></button>
        </li>)}
      </ul>
    </section>}

    {teams.length > 0 && <>
      <section aria-labelledby="next-heats-title" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="next-heats-title" className="mg-display text-2xl font-bold">Next heats</h2>
          {days.length > 1 && <label className="text-sm">Day <select className="input !w-auto" value={day} onChange={(event) => setSelectedDay(event.target.value)}>{days.map((date) => <option key={date} value={date}>{new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</option>)}</select></label>}
        </div>
        {!upcoming.length && <p className="mg-card p-4">{rows.length ? 'No more heats for your teams on this day.' : 'Your teams haven’t been drawn into any heats yet.'}</p>}
        <ol className="space-y-3">{upcoming.map((row) => <li key={row.key} className="grid grid-cols-[3.5rem_1fr] gap-3">
          <time className="mg-display pt-3 text-xl font-bold" dateTime={row.effective?.toISOString()}>{formatTime(row.effective)}</time>
          <Link className="mg-card block min-w-0 border-l-4 border-l-[rgb(var(--mg-heading))] p-3 !no-underline" to={`../session/${row.session.id}?heat=${row.heat!.id}`}>
            <div className="flex flex-wrap items-center gap-2"><h3 className="font-bold">{displaySectionName(row.session.sectionName || row.session.name)} · {row.heat!.label || `Heat ${row.heatIndex + 1}`}</h3>
              {row.status === 'live' && <span className={`mg-badge ${isStale ? '' : 'mg-badge-live'}`}>{isStale ? 'Was in arena' : 'On now'}</span>}
            </div>
            <p className="mg-meta mt-1">{row.session.name}{arenaToShow(row.session, arenas) && ` · ${arenaToShow(row.session, arenas)}`}</p>
            {row.scores.map((score) => <p key={score.team.id} className="mt-1 text-sm font-medium">{score.team.displayName} · Lane {score.lane}</p>)}
          </Link>
        </li>)}</ol>
        {upcoming.length > 0 && <p className="mg-meta">Heat times are estimates. Check the timetable and listen for the collecting ring call.</p>}
      </section>
      <section aria-labelledby="latest-results-title" className="space-y-3">
        <div className="flex items-center justify-between gap-3"><h2 id="latest-results-title" className="mg-display text-2xl font-bold">Latest results</h2><Link to="../toplists" className="mg-text-link">Toplists</Link></div>
        {!results.length && <p className="mg-card p-4">No scores have been received for your teams yet.</p>}
        {results.map((row) => <Link key={row.key} to={`../session/${row.session.id}?heat=${row.heat!.id}`} className="mg-card block p-3 !no-underline">
          <p className="mg-meta mb-1">{row.session.name} · {row.heat!.label || `Heat ${row.heatIndex + 1}`} · {row.status === 'finished' ? 'Heat finished' : 'In progress'}</p>
          {row.scores.filter((score) => score.racesRun > 0).map((score) => <div key={score.team.id} className="flex justify-between gap-3 py-1"><span className="font-semibold">{score.team.displayName}{score.team.isHorsConcours ? ' (HC)' : ''}</span><span>{score.points} pts · {score.racesRun} {score.racesRun === 1 ? 'race' : 'races'}</span></div>)}
        </Link>)}
        <p className="mg-meta">These are heat totals. Final standings and any corrections appear in the toplists.</p>
      </section>
    </>}
  </div>;
}
