import { useMemo, useState } from 'react';
import { FollowStar } from '../../components/FollowStar';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { Dropdown } from '../../components/Dropdown';
import { Notice } from '../../components/Notice';
import { usePageWidth } from '../../components/pageWidthState';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { useFavourites } from '../../hooks/useFavourites';
import { arenaNames, arenaToShow, followedHeats, heatName, nextHeats, type FollowedHeat } from '../../lib/following';
import { displaySectionName } from '../../lib/section';
import { formatShiftDelta, formatTime } from '../../lib/time';
import { dayKey, defaultTimetableDay } from '../../lib/timetableDay';
import { sessionOrdinals } from '../../lib/timetableRows';
import { useCompetition } from './context';
import { LIVE_SAVED_COPY_NOTICE_AFTER_MS, lastUpdatedText, shouldNoticeSavedCopy } from '../../offline/savedCopies';
import { formatPoints } from '../../lib/formatPoints';
import { HeatRing } from '../../components/HeatRing';
import { useLanguage } from '../../i18n/LanguageContext';

export function FollowingTab() {
  usePageWidth('wide');
  const { t, locale } = useLanguage();
  const dayText = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  const { competition, updatedAt, isStale, reload } = useCompetition();
  const { favourites, error, toggle, setMany } = useFavourites();
  const [search, setSearch] = useState('');
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
  // Followed teams are listed above, so the finder only offers the others: a few to start with, every match once you type.
  const findable = filtered.filter((team) => !ids.has(team.id)).slice(0, query ? 30 : 8);
  const clubs = useMemo(() => {
    const byClub = new Map<number, { id: number; name: string; teamIds: number[] }>();
    for (const team of competition.teams) {
      const club = byClub.get(team.clubId) ?? { id: team.clubId, name: team.clubName, teamIds: [] };
      club.teamIds.push(team.id);
      byClub.set(team.clubId, club);
    }
    return [...byClub.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [competition.teams]);
  const shownClubs = clubs.filter((club) => filtered.some((team) => team.clubId === club.id)).slice(0, query ? 8 : 3);
  const followClub = (teamIds: number[], follow: boolean) => setMany(teamIds.map((teamId) => ({ competitionId: competition.id, teamId })), follow);
  const updated = updatedAt ? updatedAt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : null;
  usePageHeader({ title: t('teams.following.title'), subtitle: updated ? `${competition.name} · ${updated}` : competition.name, onRefresh: reload, refreshLabel: t('common.refresh') });

  const where = (row: FollowedHeat) => {
    const ordinal = ordinals.get(row.session.id);
    const arena = arenaToShow(row.session, arenas);
    return [displaySectionName(row.session.sectionName || row.session.name), row.group === 'Finals' || !ordinal ? heatName(row) : t('teams.following.sessionHeat', { session: ordinal, heat: heatName(row) }), arena].filter(Boolean).join(' · ');
  };
  const onNowText = (row: FollowedHeat) => {
    const orderedRaces = row.heat ? row.heat.races.slice().sort((a, b) => a.orderIndex - b.orderIndex) : [];
    if (orderedRaces.length === 0) return t('teams.following.onNowCaps');
    const runningIdx = orderedRaces.findIndex((r) => !r.isComplete);
    const currentRaceNum = runningIdx >= 0 ? runningIdx + 1 : orderedRaces.length;
    return t('teams.following.onNowRace', { current: currentRaceNum, total: orderedRaces.length });
  };
  /** What a followed team does next, in the words under its name. */
  const nextLine = (teamId: number) => {
    const state = next.get(teamId);
    if (state?.kind === 'heat') {
      return t('teams.following.next', { detail: [heatName(state.row), t('teams.team.lane', { number: state.lane }), state.row.status === 'live' && !isStale ? t('teams.following.onNowLower') : formatTime(state.row.effective)].join(' · ') });
    }
    return state?.kind === 'done' ? t('teams.following.heatsDone') : t('teams.following.notDrawn');
  };
  const star = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[rgb(var(--mg-heading))] hover:bg-[rgb(var(--mg-subtle))]';

  return <div className="mx-auto flex w-full max-w-xl flex-col gap-4 pb-2 pt-3 lg:max-w-3xl">
    {error && <Notice>{error}</Notice>}
    {isStale && shouldNoticeSavedCopy(updatedAt, true, new Date(), LIVE_SAVED_COPY_NOTICE_AFTER_MS) && <Notice tone="info" actionLabel={t('common.refresh')} onAction={reload}>{t('teams.following.timesChanged', { updated: lastUpdatedText(updatedAt) })}</Notice>}
    {missing.map((teamId) => <Notice key={teamId} tone="info" role={null} actionLabel={t('teams.following.removeIt')} onAction={() => toggle({ competitionId: competition.id, teamId })}>{t('teams.following.goneOne')}</Notice>)}

    {teams.length > 0 && <section aria-labelledby="followed-teams-title" className="mg-sec">
      <div className="mg-sec-head"><h2 id="followed-teams-title">{t('teams.following.teamsYouFollow')}</h2></div>
      <ul className="mg-card divide-y divide-[rgb(var(--mg-rule-soft))] overflow-hidden">
        {teams.map((team) => <li key={team.id} className="flex min-h-14 items-center gap-1 py-1.5 pl-4 pr-1.5">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <Link to={`/competitions/${competition.id}/teams/${team.id}`} className="truncate text-base font-semibold leading-tight text-[rgb(var(--mg-ink))] hover:underline">{team.displayName}</Link>
            <span className="truncate text-[13.5px] leading-tight text-[rgb(var(--mg-muted))]">{nextLine(team.id)}</span>
          </div>
          {(() => {
            const state = next.get(team.id);
            return state?.kind === 'heat' && !isStale ? <HeatRing at={state.row.effective} live={state.row.status === 'live'} /> : null;
          })()}
          <button type="button" className={star} aria-pressed="true" aria-label={t('teams.unfollow', { name: team.displayName })} onClick={() => toggle({ competitionId: competition.id, teamId: team.id })}><FollowStar on className="h-[22px] w-[22px]" /></button>
        </li>)}
      </ul>
    </section>}

    {teams.length > 0 && <>
      <section aria-labelledby="next-heats-title" className="mg-sec">
        <div className="mg-sec-head">
          <h2 id="next-heats-title">{t('teams.following.nextHeats')}</h2>
          {days.length > 1
            ? <Dropdown label={t('teams.following.day')} value={day} onChange={setSelectedDay} className="w-36" buttonClassName="flex min-h-9 w-full items-center justify-between gap-1 text-xs font-medium text-[rgb(var(--mg-muted))]" options={days.map((date) => ({ value: date, label: dayText(date) }))}>
                <span>{dayText(day)}</span><ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              </Dropdown>
            : day && <span>{dayText(day)}</span>}
        </div>
        {!upcoming.length && <p className="mg-card p-4">{rows.length ? t('teams.following.noMoreHeats') : t('teams.following.noDrawn')}</p>}
        {upcoming.length > 0 && <ol className="mg-lines">{upcoming.flatMap((row) => row.scores.map((score) => {
          const late = row.status === 'late';
          const live = row.status === 'live';
          return <li key={`${row.key}-${score.team.id}`}>
            <Link className={`mg-line grid-cols-[44px_minmax(0,1fr)_14px] !gap-x-2.5 ${late ? 'mg-line-late' : ''}`} to={`../session/${row.session.id}?heat=${row.heat!.id}`}>
              <time className={`mg-line-time ${late ? 'text-[rgb(var(--mg-late-time))]' : ''}`} dateTime={row.effective?.toISOString()}>{formatTime(row.effective)}</time>
              <span className="flex min-w-0 flex-col gap-[3px]">
                <span className="flex items-baseline gap-1.5 overflow-hidden whitespace-nowrap">
                  <strong className="truncate text-[15px] font-semibold">{score.team.displayName}</strong>
                  <span className="text-xs text-[rgb(var(--mg-muted))]">{t('teams.team.lane', { number: score.lane })}</span>
                  {live && <span className="text-[10px] font-bold tracking-[0.06em] text-[rgb(var(--mg-red))]">{isStale ? t('teams.following.wasInArena') : onNowText(row)}</span>}
                  {late && <span className="text-xs text-[rgb(var(--mg-late-time))]">{row.delayMinutes >= 60 ? formatShiftDelta(row.delayMinutes) : `+${row.delayMinutes}`} · <s>{formatTime(row.scheduled)}</s></span>}
                </span>
                <span className="mg-line-sub">{where(row)}</span>
              </span>
              <ChevronRight className="h-3.5 w-3.5 text-[rgb(var(--mg-faint))]" aria-hidden="true" />
            </Link>
          </li>;
        }))}</ol>}
        {upcoming.length > 0 && <p className="mg-meta px-1">{t('teams.following.estimates')}</p>}
      </section>
      <section aria-labelledby="latest-results-title" className="mg-sec">
        <div className="mg-sec-head"><h2 id="latest-results-title">{t('teams.following.latestResults')}</h2><Link to="../toplists">{t('teams.following.toplists')}</Link></div>
        {!results.length && <p className="mg-card p-4">{t('teams.following.noScores')}</p>}
        {results.length > 0 && <div className="mg-lines">{results.flatMap((row) => row.scores.filter((score) => score.racesRun > 0).map((score) =>
          <Link key={`${row.key}-${score.team.id}`} to={`../session/${row.session.id}?heat=${row.heat!.id}`} className="mg-line grid-cols-[minmax(0,1fr)_auto] !min-h-[52px]">
            <span className="flex min-w-0 flex-col gap-[3px]">
              <strong className="mg-line-title">{score.team.displayName}{score.team.isHorsConcours ? ' (HC)' : ''}</strong>
              <span className="mg-line-sub">{where(row)} · {row.status === 'finished' ? t('teams.following.finishedLower') : t('teams.following.inProgress')}</span>
            </span>
            <span className="flex flex-col items-end gap-0.5"><span className="mg-line-time">{t('teams.team.pts', { points: formatPoints(score.points) })}</span><span className="text-[11px] text-[rgb(var(--mg-muted))]">{t('teams.following.races', { count: score.racesRun })}</span></span>
          </Link>))}</div>}
        <p className="mg-meta px-1">{t('teams.following.heatTotals')}</p>
      </section>
    </>}

    <section aria-labelledby="find-team-title" className="mg-sec">
      <div className="mg-sec-head"><h2 id="find-team-title">{t('teams.following.findTeam')}</h2></div>
      <label className="flex h-[46px] items-center gap-2.5 rounded-full border-[1.5px] border-[rgb(var(--mg-control))] bg-[rgb(var(--mg-surface))] px-4 text-[rgb(var(--mg-muted))] focus-within:border-[rgb(var(--mg-heading))]">
        <Search aria-hidden="true" className="h-[18px] w-[18px] shrink-0" strokeWidth={2.2} />
        <input type="search" aria-label={t('teams.following.findAria')} placeholder={t('teams.following.findPlaceholder')} value={search} onChange={(event) => setSearch(event.target.value)}
          className="h-full min-w-0 flex-1 border-0 bg-transparent text-base text-[rgb(var(--mg-ink))] outline-none placeholder:text-[rgb(var(--mg-faint))]" />
      </label>
      {!filtered.length && <p className="mg-meta px-1">{competition.teams.length ? t('teams.following.noMatch') : t('teams.following.noTeams')}</p>}
      {(shownClubs.length > 0 || findable.length > 0) && <div className="mg-card divide-y divide-[rgb(var(--mg-rule-soft))] overflow-hidden">
        {shownClubs.length > 0 && <ul aria-label={t('teams.following.clubs')} className="divide-y divide-[rgb(var(--mg-rule-soft))]">
          {shownClubs.map((club) => {
            const following = club.teamIds.every((id) => ids.has(id));
            return <li key={club.id} className="flex min-h-14 items-center gap-3 py-1.5 pl-4 pr-3">
              <div className="min-w-0 flex-1"><p className="break-words text-base font-semibold leading-tight">{club.name}</p><p className="mg-meta">{t('teams.following.teamCount', { count: club.teamIds.length })}</p></div>
              <button type="button" className="inline-flex min-h-9 shrink-0 items-center rounded-full border-[1.5px] border-[rgb(var(--mg-heading))] bg-[rgb(var(--mg-surface))] px-3.5 text-sm font-bold text-[rgb(var(--mg-heading))]" aria-pressed={following} aria-label={t(following ? 'teams.following.unfollowClubAria' : 'teams.following.followClubAria', { name: club.name })} onClick={() => followClub(club.teamIds, !following)}>{following ? t('teams.following.unfollowClub') : t('teams.following.followClub')}</button>
            </li>;
          })}
        </ul>}
        {findable.length > 0 && <ul className="divide-y divide-[rgb(var(--mg-rule-soft))]">
          {findable.map((team) => <li key={team.id} className="flex min-h-14 items-center gap-1 py-1.5 pl-4 pr-1.5">
            <div className="min-w-0 flex-1"><Link to={`/competitions/${competition.id}/teams/${team.id}`} className="break-words text-base font-semibold leading-tight text-[rgb(var(--mg-ink))] hover:underline">{team.displayName}</Link><p className="mg-meta">{displaySectionName(team.sectionName)}</p></div>
            <button type="button" className={star} aria-pressed={ids.has(team.id)} aria-label={t(ids.has(team.id) ? 'teams.unfollow' : 'teams.follow', { name: team.displayName })} onClick={() => toggle({ competitionId: competition.id, teamId: team.id })}><FollowStar on={ids.has(team.id)} className="h-[22px] w-[22px]" /></button>
          </li>)}
        </ul>}
      </div>}
    </section>
  </div>;
}
