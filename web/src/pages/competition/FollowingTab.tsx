import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { FollowStar } from '../../components/FollowStar';
import { Link } from 'react-router-dom';
import { ChevronRight, Search } from 'lucide-react';
import { Notice } from '../../components/Notice';
import { usePageWidth } from '../../components/pageWidthState';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { useFavourites } from '../../hooks/useFavourites';
import { useNow } from '../../hooks/useNow';
import { arenaNames, arenaToShow, followedHeats, heatName, nextHeats, type FollowedHeat, type TeamNext } from '../../lib/following';
import { followGroup, heatStanding, lastResult, minutesToGo, raceProgress, type FollowGroup } from '../../lib/followingCards';
import { parseBibAndFlag } from '../../lib/bib';
import { displaySectionName } from '../../lib/section';
import { formatTime } from '../../lib/time';
import { ordinalText, toplistNoteText, toplistNoteTone } from '../../lib/toplistText';
import { EASE_OUT } from '../../lib/motion';
import type { Team } from '../../types';
import { useCompetition } from './context';
import { useFollowedToplists } from './useFollowedToplists';
import { lastUpdatedText } from '../../offline/savedCopies';
import { useIsOld } from '../../live/useIsOld';
import { formatPoints } from '../../lib/formatPoints';
import { useLanguage } from '../../i18n/LanguageContext';
import './following.css';

const PUSH = { mgTransition: 'push' } as const;
const GROUPS = [
  { id: 'now', title: 'teams.following.groupNow' },
  { id: 'next', title: 'teams.following.groupNext' },
  { id: 'done', title: 'teams.following.groupDone' },
] as const satisfies readonly { id: FollowGroup; title: string }[];

/**
 * The people and teams you follow at this event, one card each: the heat on now or next, where the team stands in its
 * age group (with the toplist's note on what it needs), or its last heat once it has nothing left to ride. Cards are
 * grouped On now, Up next and Done for today, and every row opens the heat or the toplist.
 */
export function FollowingTab() {
  usePageWidth('wide');
  const { t, lang } = useLanguage();
  const { competition, updatedAt, isStale, reload } = useCompetition();
  const { favourites, error, toggle, setMany } = useFavourites();
  const now = useNow(30_000);
  const [search, setSearch] = useState('');
  const ids = useMemo(() => new Set(favourites.filter((f) => f.competitionId === competition.id).map((f) => f.teamId)), [favourites, competition.id]);
  const teams = competition.teams.filter((team) => ids.has(team.id));
  const missing = [...ids].filter((id) => !competition.teams.some((team) => team.id === id));
  const rows = useMemo(() => followedHeats(competition, ids), [competition, ids]);
  const next = useMemo(() => nextHeats(competition, ids), [competition, ids]);
  const arenas = useMemo(() => arenaNames(competition.sessions), [competition.sessions]);
  const lists = useFollowedToplists(competition, teams.map((team) => team.competitionSectionId));
  const stale = isStale === true;
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
  const old = useIsOld(updatedAt);
  usePageHeader({
    title: t('teams.following.title'),
    subtitle: teams.length ? `${competition.name} · ${t('teams.following.teamCount', { count: teams.length })}` : competition.name,
    onRefresh: reload,
    refreshLabel: t('common.refresh'),
  });

  // Up next runs soonest first; a team with no heat drawn yet goes last.
  const startsAt = (team: Team) => { const state = next.get(team.id); return state?.kind === 'heat' ? state.row.effective?.getTime() ?? Infinity : Infinity; };
  const grouped = GROUPS.map(({ id, title }) => {
    const members = teams.filter((team) => followGroup(next.get(team.id), stale) === id);
    return { id, title, teams: id === 'next' ? members.sort((a, b) => startsAt(a) - startsAt(b)) : members };
  }).filter((group) => group.teams.length > 0);

  const where = (row: FollowedHeat, team: Team) => `${displaySectionName(row.session.sectionName || team.sectionName)} ${heatName(row)}`.trim();
  const arenaLane = (row: FollowedHeat, lane: number) => [arenaToShow(row.session, arenas), t('teams.following.laneLower', { number: lane })].filter(Boolean).join(' · ');
  const chevron = <ChevronRight className="fc-chev h-3.5 w-3.5" aria-hidden="true" />;

  /** The first line of a card: the heat on now or next. */
  const heatLine = (team: Team, state: TeamNext | undefined, group: FollowGroup) => {
    if (state?.kind === 'undrawn') return <p key="heat" className="fc-line !grid-cols-1 text-[13.5px] text-[rgb(var(--mg-muted))]">{t('teams.following.notDrawn')}</p>;
    if (state?.kind !== 'heat') return null;
    const { row, lane } = state;
    const to = `/competitions/${competition.id}/session/${row.session.id}?heat=${row.heat!.id}`;
    if (group === 'now') {
      const progress = raceProgress(row.heat!);
      const standing = heatStanding(row.heat!, team.id);
      const title = progress ? t('teams.following.raceOf', { heat: where(row, team), current: progress.current, total: progress.total }) : where(row, team);
      const sofar = standing ? `${t('teams.following.placeSoFar', { place: ordinalText(standing.place, lang) })}, ${t('teams.team.pts', { points: formatPoints(standing.points) })}` : null;
      return <Link key="heat" to={to} state={PUSH} className="fc-line"><span className="fc-lead is-now">{t('teams.following.onNowCaps')}</span><span className="fc-what"><strong>{title}</strong><span>{[arenaLane(row, lane), sofar].filter(Boolean).join(' · ')}</span></span>{chevron}</Link>;
    }
    const minutes = minutesToGo(row.effective, now);
    const title = minutes != null ? t('teams.following.inMinutes', { heat: where(row, team), minutes }) : where(row, team);
    return <Link key="heat" to={to} state={PUSH} className="fc-line"><time className={`fc-lead${row.status === 'late' ? ' is-late' : ''}`} dateTime={row.effective?.toISOString()}>{formatTime(row.effective)}</time><span className="fc-what"><strong>{title}</strong><span>{arenaLane(row, lane)}</span></span>{chevron}</Link>;
  };
  /** The team's latest finished heat, in the same words as a heat row. */
  const lastLine = (team: Team) => {
    const last = lastResult(rows, team.id);
    if (!last) return null;
    return <Link key="last" to={`/competitions/${competition.id}/session/${last.row.session.id}?heat=${last.row.heat!.id}`} state={PUSH} className="fc-line">
      <span className="fc-lead is-label">{t('teams.following.lastLabel')}</span>
      <span className="fc-what"><strong>{`${where(last.row, team)} · ${ordinalText(last.place, lang)} · ${t('teams.team.pts', { points: formatPoints(last.points) })}`}</strong></span>{chevron}
    </Link>;
  };
  /** Where the team stands in its age group, with the same note the Toplists page gives it. */
  const toplistLine = (team: Team) => {
    const list = lists.get(team.competitionSectionId);
    const row = !team.isHorsConcours && list?.started ? list.rows.find((item) => item.teamId === team.id) : undefined;
    if (!row) return null;
    const note = toplistNoteText(row, t);
    const tone = toplistNoteTone(row);
    return <Link key="toplist" to={`/competitions/${competition.id}/toplists?section=${team.competitionSectionId}`} state={PUSH} className="fc-line">
      <span className="fc-lead">{`${row.joint ? '=' : ''}${ordinalText(row.position, lang)}`}</span>
      <span className="fc-what"><strong>{`${t('teams.following.sectionToplist', { section: displaySectionName(team.sectionName) })} · ${t('teams.team.pts', { points: formatPoints(row.points) })}`}</strong>{note && <span className={tone === 'safe' ? 'is-safe' : tone === 'need' ? 'is-need' : undefined}>{note}</span>}</span>{chevron}
    </Link>;
  };
  const card = (team: Team, group: FollowGroup) => {
    const { bib, flag } = parseBibAndFlag(team.bibDescription);
    const bibs = bib || team.bibColour;
    const toplist = toplistLine(team);
    // A team with a heat ahead shows it, then its place; a team that has no place yet shows its last heat in that slot.
    // A team with nothing left to ride shows its last heat first, then its place.
    const lines = group === 'done' ? [lastLine(team), toplist] : [heatLine(team, next.get(team.id), group), toplist ?? lastLine(team)];
    return <motion.li key={team.id} layout="position" transition={{ duration: 0.4, ease: EASE_OUT }} className={`fc-card${group === 'now' ? ' is-live' : ''}`}>
      <div className="fc-top">
        <Link to={`/competitions/${competition.id}/teams/${team.id}`} className="fc-name">
          {flag && <img src={`/flags/${flag}.png`} alt="" className="mr-1.5 inline-block h-3.5 w-5 shrink-0 rounded-[2px] object-cover align-middle" />}
          {team.displayName}
          <small>{[displaySectionName(team.sectionName), bibs ? (/\bbibs?\b/i.test(bibs) ? bibs : t('teams.following.bibs', { colour: bibs })) : null].filter(Boolean).join(' · ')}</small>
        </Link>
        <button type="button" className="fc-star" aria-pressed="true" aria-label={t('teams.unfollow', { name: team.displayName })} onClick={() => toggle({ competitionId: competition.id, teamId: team.id })}><FollowStar on className="h-[22px] w-[22px]" /></button>
      </div>
      {lines}
    </motion.li>;
  };
  const star = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[rgb(var(--mg-heading))] hover:bg-[rgb(var(--mg-subtle))]';

  return <div className="mx-auto flex w-full max-w-xl flex-col gap-4 pb-2 pt-3 lg:max-w-3xl">
    {error && <Notice>{error}</Notice>}
    {isStale && old && <Notice tone="info" actionLabel={t('common.refresh')} onAction={reload}>{t('teams.following.timesChanged', { updated: lastUpdatedText(updatedAt) })}</Notice>}
    {missing.map((teamId) => <Notice key={teamId} tone="info" role={null} actionLabel={t('teams.following.removeIt')} onAction={() => toggle({ competitionId: competition.id, teamId })}>{t('teams.following.goneOne')}</Notice>)}

    {grouped.map((group) => <section key={group.id} aria-labelledby={`following-${group.id}`} className="mg-sec">
      <div className="mg-sec-head"><h2 id={`following-${group.id}`}>{t(group.title)}</h2><span>{t('teams.following.teamCount', { count: group.teams.length })}</span></div>
      <ul className="flex flex-col gap-3">{group.teams.map((team) => card(team, group.id))}</ul>
    </section>)}

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
