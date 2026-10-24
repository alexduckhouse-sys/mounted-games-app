import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Plus, Star } from 'lucide-react';
import { Dropdown } from '../../components/Dropdown';
import { usePageWidth } from '../../components/pageWidthState';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { useFavourites } from '../../hooks/useFavourites';
import { arenaNames, arenaToShow, followedHeats, heatName, nextHeats, type FollowedHeat } from '../../lib/following';
import { displaySectionName } from '../../lib/section';
import { formatTime } from '../../lib/time';
import { dayKey, defaultTimetableDay } from '../../lib/timetableDay';
import { sessionOrdinals } from '../../lib/timetableRows';
import { useCompetition } from './context';
import { LIVE_SAVED_COPY_NOTICE_AFTER_MS, lastUpdatedText, shouldNoticeSavedCopy } from '../../offline/savedCopies';
import { formatPoints } from '../../lib/formatPoints';

const dayText = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

export function FollowingTab() {
  usePageWidth('wide');
  const { competition, updatedAt, isStale, reload } = useCompetition();
  const { favourites, error, toggle, setMany } = useFavourites();
  const [search, setSearch] = useState('');
  const [showTeams, setShowTeams] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState('');
  const ids = useMemo(() => new Set(favourites.filter((f) => f.competitionId === competition.id).map((f) => f.teamId)), [favourites, competition.id]);
  const teams = competition.teams.filter((team) => ids.has(team.id));
  const missing = [...ids].filter((id) => !competition.teams.some((team) => team.id === id));
  const rows = useMemo(() => followedHeats(competition, ids), [competition, ids]);
  const next = useMemo(() => nextHeats(competition, ids), [competition, ids]);
  const ordinals = useMemo(() => sessionOrdinals(competition.sessions), [competition.sessions]);
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
  const updated = updatedAt ? updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null;
  usePageHeader({ title: 'Following', subtitle: updated ? `${competition.name} · ${updated}` : competition.name, onRefresh: reload, refreshLabel: 'Refresh' });

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!listOpen) return;
    const close = (event: PointerEvent) => { if (!listRef.current?.contains(event.target as Node)) setListOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setListOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [listOpen]);

  const where = (row: FollowedHeat) => {
    const ordinal = ordinals.get(row.session.id);
    const arena = arenaToShow(row.session, arenas);
    return [displaySectionName(row.session.sectionName || row.session.name), row.group === 'Finals' || !ordinal ? heatName(row) : `Session ${ordinal}, ${heatName(row)}`, arena].filter(Boolean).join(' · ');
  };
  const choosing = showTeams || teams.length === 0;

  return <div className="mx-auto flex w-full max-w-xl flex-col gap-4 pb-2 lg:max-w-3xl">
    <div ref={listRef} className="mg-band mg-band-header relative z-10 py-2.5">
      <button type="button" aria-expanded={listOpen} aria-controls="followed-teams" onClick={() => setListOpen(!listOpen)}
        className={`flex min-h-11 w-full items-center gap-2 rounded-lg border border-[rgb(var(--mg-header-line))] px-3 text-left text-sm font-semibold text-white ${listOpen ? 'bg-white/10' : ''}`}>
        <Star className="h-4 w-4 shrink-0 fill-[#F2C14E] text-[#F2C14E]" aria-hidden="true" />
        <span className="shrink-0">Following {teams.length} {teams.length === 1 ? 'team' : 'teams'}</span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-[rgb(var(--mg-header-sub))]">{teams.map((team) => team.displayName).join(', ')}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 ${listOpen ? 'rotate-180' : ''}`} strokeWidth={2.25} aria-hidden="true" />
      </button>
      {listOpen && <div id="followed-teams" className="absolute inset-x-0 top-[60px] overflow-hidden rounded-[10px] border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-surface))] text-[rgb(var(--mg-ink))] shadow-[0_10px_28px_rgb(15_42_74/0.22)]">
        {teams.map((team) => {
          const state = next.get(team.id);
          const when = state?.kind === 'heat' ? `next ${formatTime(state.row.effective)}` : state?.kind === 'done' ? 'heats done' : 'not drawn yet';
          return <div key={team.id} className="grid min-h-[52px] grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-x-2.5 border-t border-[rgb(var(--mg-rule-soft))] py-1 pl-3 pr-1.5 first:border-t-0">
            <Star className="h-4 w-4 fill-[#C08308] text-[#C08308]" aria-hidden="true" />
            <span className="flex min-w-0 flex-col gap-0.5"><strong className="truncate text-[15px] font-semibold">{team.displayName}</strong><span className="truncate text-xs text-[rgb(var(--mg-muted))]">{displaySectionName(team.sectionName)} · {when}</span></span>
            <button className="min-h-11 rounded-lg px-3 text-[13px] font-semibold text-[rgb(var(--mg-elim))]" aria-label={`Unfollow ${team.displayName}`} onClick={() => toggle({ competitionId: competition.id, teamId: team.id })}>Unfollow</button>
          </div>;
        })}
        <button className="flex min-h-12 w-full items-center gap-2 border-t border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-ground))] px-3 text-left text-sm font-semibold text-[rgb(var(--mg-heading))]" onClick={() => { setShowTeams(true); setListOpen(false); }}>
          <Plus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />Add teams
        </button>
      </div>}
    </div>
    {error && <p role="alert" className="mg-notice">{error}</p>}
    {isStale && shouldNoticeSavedCopy(updatedAt, true, new Date(), LIVE_SAVED_COPY_NOTICE_AFTER_MS) && <p role="status" className="mg-notice">{lastUpdatedText(updatedAt)}. Times may have changed.
      <button className="mg-text-link ml-3 !min-h-11" onClick={reload}>Refresh</button></p>}
    {missing.map((teamId) => <p key={teamId} className="mg-notice">A followed team is no longer listed at this event. <button className="mg-text-link !min-h-11" onClick={() => toggle({ competitionId: competition.id, teamId })}>Remove saved team</button></p>)}

    {choosing && <section className="mg-card space-y-3 p-4" aria-label="Choose teams">
      {teams.length === 0 && <p>Star a team to see its next heats and results here. Stars are saved on this device, and no sign-in is needed.</p>}
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
      {teams.length > 0 && <button className="mg-btn mg-btn-secondary w-full" onClick={() => setShowTeams(false)}>Close team picker</button>}
    </section>}

    {teams.length > 0 && <>
      <section aria-labelledby="next-heats-title" className="mg-sec">
        <div className="mg-sec-head">
          <h2 id="next-heats-title">Next heats</h2>
          {days.length > 1
            ? <Dropdown label="Day" value={day} onChange={setSelectedDay} className="w-36" buttonClassName="flex min-h-9 w-full items-center justify-between gap-1 text-xs font-medium text-[rgb(var(--mg-muted))]" options={days.map((date) => ({ value: date, label: dayText(date) }))}>
                <span>{dayText(day)}</span><ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              </Dropdown>
            : day && <span>{dayText(day)}</span>}
        </div>
        {!upcoming.length && <p className="mg-card p-4">{rows.length ? 'No more heats for your teams on this day.' : 'Your teams haven’t been drawn into any heats yet.'}</p>}
        {upcoming.length > 0 && <ol className="mg-lines">{upcoming.flatMap((row) => row.scores.map((score) => {
          const late = row.status === 'late';
          const live = row.status === 'live';
          return <li key={`${row.key}-${score.team.id}`}>
            <Link className={`mg-line grid-cols-[44px_minmax(0,1fr)_14px] !gap-x-2.5 ${late ? 'mg-line-late' : ''}`} to={`../session/${row.session.id}?heat=${row.heat!.id}`}>
              <time className={`mg-line-time ${late ? 'text-[rgb(var(--mg-late-time))]' : ''}`} dateTime={row.effective?.toISOString()}>{formatTime(row.effective)}</time>
              <span className="flex min-w-0 flex-col gap-[3px]">
                <span className="flex items-baseline gap-1.5 overflow-hidden whitespace-nowrap">
                  <strong className="truncate text-[15px] font-semibold">{score.team.displayName}</strong>
                  <span className="text-xs text-[rgb(var(--mg-muted))]">Lane {score.lane}</span>
                  {live && <span className="text-[10px] font-bold tracking-[0.06em] text-[rgb(var(--mg-red))]">{isStale ? 'WAS IN ARENA' : 'ON NOW'}</span>}
                  {late && <span className="text-xs text-[rgb(var(--mg-late-time))]">+{row.delayMinutes} · <s>{formatTime(row.scheduled)}</s></span>}
                </span>
                <span className="mg-line-sub">{where(row)}</span>
              </span>
              <ChevronRight className="h-3.5 w-3.5 text-[rgb(var(--mg-faint))]" aria-hidden="true" />
            </Link>
          </li>;
        }))}</ol>}
        {upcoming.length > 0 && <p className="mg-meta px-1">Heat times are estimates. Check the timetable and listen for the collecting ring call.</p>}
      </section>
      <section aria-labelledby="latest-results-title" className="mg-sec">
        <div className="mg-sec-head"><h2 id="latest-results-title">Latest results</h2><Link to="../toplists">Toplists</Link></div>
        {!results.length && <p className="mg-card p-4">No scores have been received for your teams yet.</p>}
        {results.length > 0 && <div className="mg-lines">{results.flatMap((row) => row.scores.filter((score) => score.racesRun > 0).map((score) =>
          <Link key={`${row.key}-${score.team.id}`} to={`../session/${row.session.id}?heat=${row.heat!.id}`} className="mg-line grid-cols-[minmax(0,1fr)_auto] !min-h-[52px]">
            <span className="flex min-w-0 flex-col gap-[3px]">
              <strong className="mg-line-title">{score.team.displayName}{score.team.isHorsConcours ? ' (HC)' : ''}</strong>
              <span className="mg-line-sub">{where(row)} · {row.status === 'finished' ? 'finished' : 'in progress'}</span>
            </span>
            <span className="flex flex-col items-end gap-0.5"><span className="mg-line-time">{formatPoints(score.points)} pts</span><span className="text-[11px] text-[rgb(var(--mg-muted))]">{score.racesRun} {score.racesRun === 1 ? 'race' : 'races'}</span></span>
          </Link>))}</div>}
        <p className="mg-meta px-1">These are heat totals. Final standings and any corrections appear in the toplists.</p>
      </section>
    </>}
  </div>;
}
