import { HeatCalledBadge } from './reliability/CallUpStrip';
import { useHeatCalls } from './reliability/heatCalls';
import { useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { FollowStar } from '../../components/FollowStar';
import { Link } from 'react-router-dom';
import { Check, ChevronRight, Search, X } from 'lucide-react';
import { AgeGroupFilterButton, AgeGroupFilterSheet } from '../../components/AgeGroupFilter';
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
import { isUnaffiliated } from '../../lib/clubName';
import { useLanguage } from '../../i18n/LanguageContext';
import './following.css';
import { LiveActivityChoice } from '../../native/LiveActivityChoice';

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
  const { calls } = useHeatCalls(competition.id);
  const { favourites, error, toggle, setMany } = useFavourites();
  const now = useNow(30_000);
  const [search, setSearch] = useState('');
  const [sectionId, setSectionId] = useState<number | 'all'>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const ids = useMemo(() => new Set(favourites.filter((f) => f.competitionId === competition.id).map((f) => f.teamId)), [favourites, competition.id]);
  const teams = competition.teams.filter((team) => ids.has(team.id));
  const missing = [...ids].filter((id) => !competition.teams.some((team) => team.id === id));
  const rows = useMemo(() => followedHeats(competition, ids), [competition, ids]);
  const next = useMemo(() => nextHeats(competition, ids), [competition, ids]);
  const arenas = useMemo(() => arenaNames(competition.sessions), [competition.sessions]);
  const lists = useFollowedToplists(competition, teams.map((team) => team.competitionSectionId));
  const stale = isStale === true;
  const query = search.trim().toLowerCase();
  const inSection = (team: Team) => sectionId === 'all' || team.competitionSectionId === sectionId;
  const filtered = competition.teams.filter((team) => inSection(team) && `${team.displayName} ${team.clubName} ${team.sectionName}`.toLowerCase().includes(query));
  // The finder lists nothing until you type: then the clubs named like the search, and every team that matches it
  // (followed ones keep their filled star).
  const searching = query !== '';
  const clubs = useMemo(() => {
    const byClub = new Map<number, { id: number; name: string; teamIds: number[] }>();
    for (const team of competition.teams) {
      if (isUnaffiliated(team.clubName)) continue;
      const club = byClub.get(team.clubId) ?? { id: team.clubId, name: team.clubName, teamIds: [] };
      club.teamIds.push(team.id);
      byClub.set(team.clubId, club);
    }
    return [...byClub.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [competition.teams]);
  const foundClubs = searching ? clubs.filter((club) => club.name.toLowerCase().includes(query) && filtered.some((team) => team.clubId === club.id)) : [];
  const foundTeams = searching ? filtered : [];
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

  /** The second row of a card: the heat on now or next. */
  const heatLine = (team: Team, state: TeamNext | undefined, group: FollowGroup) => {
    if (state?.kind === 'undrawn') return <p key="heat" className="fc-line fc-quiet">{t('teams.following.notDrawn')}</p>;
    if (state?.kind !== 'heat') return null;
    const { row, lane } = state;
    const to = `/competitions/${competition.id}/session/${row.session.id}?heat=${row.heat!.id}`;
    if (group === 'now') {
      const progress = raceProgress(row.heat!);
      const standing = heatStanding(row.heat!, team.id);
      const title = progress ? t('teams.following.raceOf', { heat: where(row, team), current: progress.current, total: progress.total }) : where(row, team);
      const sofar = standing ? `${t('teams.following.placeSoFar', { place: ordinalText(standing.place, lang) })}, ${t('teams.team.pts', { points: formatPoints(standing.points) })}` : null;
      // The group heading already says "On now", so the line keeps only the red dot; the words stay for screen readers.
      return <Link key="heat" to={to} state={PUSH} className="fc-line fc-line-now"><span className="fc-lead is-now"><i aria-hidden="true" className="fc-dot" /><span className="sr-only">{t('teams.following.onNowCaps')}</span></span><span className="fc-what"><strong>{title}</strong><HeatCalledBadge heatId={row.heat!.id} calls={calls} /><span>{[arenaLane(row, lane), sofar].filter(Boolean).join(' · ')}</span></span>{chevron}</Link>;
    }
    const minutes = minutesToGo(row.effective, now);
    const title = minutes != null ? t('teams.following.inMinutes', { heat: where(row, team), minutes }) : where(row, team);
    return <Link key="heat" to={to} state={PUSH} className="fc-line"><time className={`fc-lead${row.status === 'late' ? ' is-late' : ''}`} dateTime={row.effective?.toISOString()}>{formatTime(row.effective)}</time><span className="fc-what"><strong>{title}</strong><HeatCalledBadge heatId={row.heat!.id} calls={calls} /><span>{arenaLane(row, lane)}</span></span>{chevron}</Link>;
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
  /**
   * The compact figure beside the team's name: where it stands in its age group (its colour and the hidden words carry the
   * toplist's note), or, while it has no place yet and still has heats to ride, its last result.
   */
  const standing = (team: Team, group: FollowGroup) => {
    const list = lists.get(team.competitionSectionId);
    const row = !team.isHorsConcours && list?.started ? list.rows.find((item) => item.teamId === team.id) : undefined;
    if (row) {
      const note = toplistNoteText(row, t);
      const tone = toplistNoteTone(row);
      return <Link key="toplist" to={`/competitions/${competition.id}/toplists?section=${team.competitionSectionId}`} state={PUSH} className="fc-stand">
        <span className="sr-only">{`${t('teams.following.sectionToplist', { section: displaySectionName(team.sectionName) })}: `}</span>
        <b className={tone === 'safe' ? 'is-safe' : tone === 'need' ? 'is-need' : undefined}>{ordinalText(row.position, lang)}</b>
        {row.joint && <span className="sr-only">{` ${t('competition.toplist.joint')}`}</span>}
        <small>{t('teams.team.pts', { points: formatPoints(row.points) })}</small>
        {note && <span className="sr-only">{`. ${note}`}</span>}
      </Link>;
    }
    const last = group === 'done' ? null : lastResult(rows, team.id);
    if (!last) return null;
    return <Link key="last" to={`/competitions/${competition.id}/session/${last.row.session.id}?heat=${last.row.heat!.id}`} state={PUSH} className="fc-stand">
      <span className="sr-only">{`${where(last.row, team)}: `}</span>
      <b>{ordinalText(last.place, lang)}</b>
      <small>{`${t('teams.following.lastLabel')} · ${t('teams.team.pts', { points: formatPoints(last.points) })}`}</small>
    </Link>;
  };
  /**
   * A followed team in two rows: its name with its place and star, then the heat on now or next (or, once it has nothing
   * left to ride, its last heat). Red is kept for the small dot of a heat on now.
   */
  const card = (team: Team, group: FollowGroup) => {
    const { bib, flag } = parseBibAndFlag(team.bibDescription);
    const bibs = bib || team.bibColour;
    return <motion.li key={team.id} layout="position" transition={{ duration: 0.4, ease: EASE_OUT }} className="fc-card">
      <div className="fc-top">
        <Link to={`/competitions/${competition.id}/teams/${team.id}`} className="fc-name">
          {flag && <img src={`/flags/${flag}.png`} alt="" className="fc-flag" />}
          {team.displayName}
          <small>{[displaySectionName(team.sectionName), bibs ? (/\bbibs?\b/i.test(bibs) ? bibs : t('teams.following.bibs', { colour: bibs })) : null].filter(Boolean).join(' · ')}</small>
        </Link>
        {standing(team, group)}
        <button type="button" className="fc-star" aria-pressed="true" aria-label={t('teams.unfollow', { name: team.displayName })} onClick={() => toggle({ competitionId: competition.id, teamId: team.id })}><FollowStar on className="h-[22px] w-[22px]" /></button>
      </div>
      {group === 'done' ? lastLine(team) : heatLine(team, next.get(team.id), group)}
      <LiveActivityChoice competitionId={competition.id} teamId={team.id} teamName={team.displayName} />
    </motion.li>;
  };
  const star = 'fw-star flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-[rgb(var(--mg-subtle))]';

  return <div className="mg-flat mx-auto flex w-full max-w-xl flex-col gap-3 pb-2 pt-3 lg:max-w-3xl">
    {error && <Notice>{error}</Notice>}
    {isStale && old && <Notice tone="info" actionLabel={t('common.refresh')} onAction={reload}>{t('teams.following.timesChanged', { updated: lastUpdatedText(updatedAt) })}</Notice>}
    {missing.map((teamId) => <Notice key={teamId} tone="info" role={null} actionLabel={t('teams.following.removeIt')} onAction={() => toggle({ competitionId: competition.id, teamId })}>{t('teams.following.goneOne')}</Notice>)}

    {grouped.map((group) => <section key={group.id} aria-labelledby={`following-${group.id}`}>
      <h2 id={`following-${group.id}`} className="fl-heading fl-ruled">{t(group.title)}<span aria-hidden="true">{t('teams.following.teamCount', { count: group.teams.length })}</span></h2>
      <ul className="fl-list m-0 list-none p-0">{group.teams.map((team) => card(team, group.id))}</ul>
    </section>)}

    {!teams.length && !missing.length && <div className="fw-empty">
      <p className="fw-empty-title">{t('teams.following.emptyTitle')}</p>
      <p className="fl-sub m-0">{t('teams.following.emptyText')}</p>
    </div>}

    <div role="search" aria-label={t('teams.following.findToFollow')}>
      <div className="fk-find">
        <div className="fw-bar">
          <label className="fw-bar-field">
            <Search aria-hidden="true" className="h-[18px] w-[18px] shrink-0" strokeWidth={2.2} />
            <input ref={searchRef} type="search" autoComplete="off" aria-label={t('teams.following.findAria')} placeholder={t('teams.following.findPlaceholder')} value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          {search && <button type="button" className="fw-clear" aria-label={t('teams.following.clearSearch')} onClick={() => { setSearch(''); searchRef.current?.focus(); }}><X aria-hidden="true" className="h-4 w-4" strokeWidth={2.4} /></button>}
        </div>
        {searching && <AgeGroupFilterButton label={t('teams.list.ageGroup')} active={sectionId !== 'all'} onClick={() => setFilterOpen(true)} />}
      </div>
      {searching && <div className="fw-results">
        {foundClubs.length + foundTeams.length === 0 && <p className="fl-sub m-0 pt-3">{competition.teams.length ? t('teams.following.noMatch') : t('teams.following.noTeams')}</p>}
        {foundClubs.length + foundTeams.length > 0 && <ul className="fl-list m-0 list-none p-0">
          {foundClubs.map((club) => {
            const followed = club.teamIds.filter((id) => ids.has(id)).length;
            const following = followed === club.teamIds.length;
            const count = t('teams.following.teamCount', { count: club.teamIds.length });
            return <li key={`club-${club.id}`} className="fl-row fw-row">
              <div className="fl-grow"><p className="fl-title m-0">{club.name}</p><p className="fl-sub m-0">{followed > 0 && !following ? t('teams.following.followedOf', { followed, count: club.teamIds.length }) : count}</p></div>
              <button type="button" className="fw-club-btn" aria-pressed={following} aria-label={t(following ? 'teams.following.unfollowClubAria' : 'teams.following.followClubAria', { name: club.name })} onClick={() => followClub(club.teamIds, !following)}>
                {following && <Check aria-hidden="true" className="h-4 w-4" strokeWidth={2.6} />}
                {following ? t('teams.following.clubFollowing') : t('teams.following.followClub')}
              </button>
            </li>;
          })}
          {foundTeams.map((team) => <li key={team.id} className="fl-row fw-row">
            <div className="fl-grow"><Link to={`/competitions/${competition.id}/teams/${team.id}`} className="fw-link fl-title">{team.displayName}</Link><p className="fl-sub m-0">{[displaySectionName(team.sectionName), isUnaffiliated(team.clubName) ? null : team.clubName].filter(Boolean).join(' · ')}</p></div>
            <button type="button" className={star} aria-pressed={ids.has(team.id)} aria-label={t(ids.has(team.id) ? 'teams.unfollow' : 'teams.follow', { name: team.displayName })} onClick={() => toggle({ competitionId: competition.id, teamId: team.id })}><FollowStar on={ids.has(team.id)} className="h-[22px] w-[22px]" /></button>
          </li>)}
        </ul>}
      </div>}
    </div>
    {filterOpen && <AgeGroupFilterSheet
      title={t('teams.list.ageGroup')}
      value={sectionId}
      shown={filtered.length}
      options={[{ id: 'all' as const, label: t('teams.list.allAgeGroups'), teams: competition.teams.length }, ...competition.sections.map((sec) => ({ id: sec.id, label: displaySectionName(sec.displayName), teams: competition.teams.filter((team) => team.competitionSectionId === sec.id).length }))]}
      onChange={setSectionId}
      onClose={() => setFilterOpen(false)}
    />}
  </div>;
}
