import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Plus } from 'lucide-react';
import { api } from '../api';
import { FollowStar } from '../components/FollowStar';
import { RoundSearch } from '../components/RoundSearch';
import { Sheet } from '../components/Sheet';
import { usePageWidth } from '../components/pageWidthState';
import { usePageHeader } from '../components/CompactPageBarContext';
import { Notice } from '../components/Notice';
import { useFavourites } from '../hooks/useFavourites';
import { useFollowedProfiles } from '../hooks/useFollowedProfiles';
import type { FollowedProfile } from '../lib/followedProfiles';
import { clubTeamCount, lastOut, nextEntry } from '../lib/followingProfiles';
import { competitionDateText, isOnToday } from '../lib/competitionDates';
import { arenaNames, nextHeats, summariseNext } from '../lib/following';
import { readSavedCopy, savedCopyKeys, serviceWorkerSavedAt, writeSavedCopy } from '../offline/savedCopies';
import { shortDate } from './seasons/seasonModel';
import { localOrdinal } from '../lib/ordinalText';
import type { TeamProfile, TeamProfileHistory } from './seasons/teamProfileTypes';
import type { CompetitionDetail, CompetitionSummary } from '../types';
import { useLanguage, useT } from '../i18n/LanguageContext';
import '../components/sitePages.css';
import '../components/filterKit.css';

/** Everything needed to place each followed team profile: its linked event teams and results, and the competitions' dates. */
function useProfileDetails(followed: FollowedProfile[]) {
  const idKey = followed.map((item) => item.id).join(',');
  const [histories, setHistories] = useState<Record<string, TeamProfileHistory | null>>({});
  // undefined while it is on its way, null when it couldn't be fetched.
  const [competitions, setCompetitions] = useState<CompetitionSummary[] | null | undefined>(undefined);
  const [profiles, setProfiles] = useState<TeamProfile[] | null>(null);
  const [profilesError, setProfilesError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api.get<TeamProfile[]>('/team-profiles', { signal: controller.signal })
      .then((response) => { if (!controller.signal.aborted) { setProfiles(Array.isArray(response.data) ? response.data : []); setProfilesError(false); } })
      .catch(() => { if (!controller.signal.aborted) setProfilesError(true); });
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    const ids = idKey ? idKey.split(',') : [];
    const missing = ids.filter((id) => !(id in histories));
    if (!ids.length || (!missing.length && competitions !== undefined)) return;
    const controller = new AbortController();
    Promise.all([
      Promise.all(missing.map((id) => api.get<TeamProfileHistory>(`/team-profiles/${id}/history`, { signal: controller.signal }).then((response) => [id, response.data] as const).catch(() => [id, null] as const))),
      competitions === undefined
        ? api.get<CompetitionSummary[]>('/competitions', { signal: controller.signal }).then((response) => (Array.isArray(response.data) ? response.data : null)).catch(() => null)
        : Promise.resolve(competitions),
    ]).then(([loaded, list]) => {
      if (controller.signal.aborted) return;
      setHistories((current) => ({ ...current, ...Object.fromEntries(loaded) }));
      setCompetitions(list);
    });
    return () => controller.abort();
  }, [idKey, histories, competitions]);

  const ids = idKey ? idKey.split(',') : [];
  const ready = ids.every((id) => id in histories) && (ids.length === 0 || competitions !== undefined);
  return { histories, competitions: competitions ?? null, profiles, profilesError, retryProfiles: () => setAttempt((value) => value + 1), ready };
}

type SearchProps = {
  profiles: TeamProfile[] | null; error: boolean; retry: () => void;
  followedIds: Set<string>; onToggle: (profile: TeamProfile) => void;
};

export function FollowingPage() {
  usePageWidth('wide');
  const t = useT();
  const { locale } = useLanguage();
  const { favourites, setMany } = useFavourites();
  const followed = useFollowedProfiles();
  const details = useProfileDetails(followed.profiles);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  // A team followed through its profile is shown once, with the profile, not again under its competition.
  const exclude = useMemo(() => new Set(followed.profiles.flatMap((item) => (details.histories[item.id]?.eventTeams ?? []).map((team) => `${team.competitionId}:${team.teamId}`))), [followed.profiles, details.histories]);
  const shownFavourites = favourites.filter((item) => !exclude.has(`${item.competitionId}:${item.teamId}`));
  const eventIds = [...new Set(shownFavourites.map((item) => item.competitionId))];
  const teamTotal = shownFavourites.length + followed.profiles.length;
  usePageHeader({
    title: t('teams.following.title'),
    subtitle: teamTotal ? `${t('teams.following.teamCount', { count: teamTotal })}${eventIds.length ? ` · ${t('teams.following.eventCount', { count: eventIds.length })}` : ''}` : undefined,
    plain: true,
  });

  const now = new Date();
  const rows = followed.profiles.map((profile) => {
    const history = details.histories[profile.id] ?? null;
    return {
      profile, history,
      name: history?.profile.displayName ?? profile.name,
      entry: history && details.competitions ? nextEntry(history.eventTeams, details.competitions, now) : null,
      last: history ? lastOut(history.publishedResults) : null,
    };
  });
  type Row = (typeof rows)[number];
  const coming = rows.filter((row) => row.entry).sort((a, b) => new Date(a.entry!.startDate).getTime() - new Date(b.entry!.startDate).getTime());
  const notEntered = rows.filter((row) => !row.entry).sort((a, b) => a.name.localeCompare(b.name));
  const unfollow = (row: Row) => {
    followed.set(row.profile, false);
    if (row.history?.eventTeams.length) setMany(row.history.eventTeams.map((team) => ({ competitionId: team.competitionId, teamId: team.teamId })), false);
  };
  const strong = 'font-semibold text-[rgb(var(--mg-ink))]';
  const subOf = (row: Row) => {
    if (row.entry) {
      const when = isOnToday(row.entry.startDate, row.entry.endDate, now) ? t('common.today') : competitionDateText(row.entry.startDate, row.entry.endDate);
      return <><b className={strong}>{when}</b> · {row.entry.competitionName}</>;
    }
    if (row.last) return <>{t('teams.following.lastOut')} <b className={strong}>{localOrdinal(row.last.place)}</b> · {row.last.competitionName}, {shortDate(row.last.date, false, locale)}</>;
    const count = details.profiles ? clubTeamCount(row.profile.id, details.profiles) : null;
    return count ? t('teams.following.clubTeams', { count }) : row.history?.profile.clubName ?? row.profile.clubName;
  };
  const group = (list: Row[], label: string) => list.length > 0 && (
    <section aria-label={label}>
      <h2 className="sp-sec !mt-0"><span>{label}</span><small>{t('teams.following.teamCount', { count: list.length })}</small></h2>
      <ul className="sp-card m-0 list-none p-0">
        {list.map((row) => (
          <li key={row.profile.id} className="sp-row !gap-1 !pr-1">
            <Link to={row.entry ? `/competitions/${row.entry.competitionId}/teams/${row.entry.teamId}` : `/team-profiles/${row.profile.id}`} className="sp-grow !text-[rgb(var(--mg-heading))] !no-underline">
              <span className="text-[21px] font-semibold leading-tight">{row.name}</span>
              <span className="sp-t2">{subOf(row)}</span>
            </Link>
            <button type="button" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[rgb(var(--mg-late-time))]" aria-pressed="true" aria-label={t('teams.unfollow', { name: row.name })} onClick={() => unfollow(row)}>
              <FollowStar on className="h-[22px] w-[22px]" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
  const search: SearchProps = {
    profiles: details.profiles, error: details.profilesError, retry: details.retryProfiles,
    followedIds: new Set(followed.profiles.map((item) => item.id)),
    onToggle: (profile) => followed.toggle({ id: profile.id, name: profile.displayName, clubName: profile.clubName }),
  };
  // The sheet sits outside the spaced column: a sibling margin would otherwise pull the dialog to the top of the screen.
  return (
    <>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 pb-2 lg:max-w-none">
        <div className="mg-band mg-band-header pb-3 pt-0">
          <RoundSearch band label={t('teams.following.findToFollow')} placeholder={t('teams.following.findToFollow')} value={query} onChange={setQuery} />
        </div>
        {followed.error && <Notice>{followed.error}</Notice>}
        {query.trim() ? <ProfileSearchResults query={query} {...search} /> : <>
          {details.ready ? <>
            {group(coming, t('teams.following.comingUp'))}
            {group(notEntered, t('teams.following.notEntered'))}
            <FollowingTeamsSection plain exclude={exclude} quietWhenEmpty={followed.profiles.length > 0} addLink={false} />
          </> : <p role="status" className="sp-note m-0">{t('teams.following.loadingEvent')}</p>}
          <button type="button" className="sp-add" aria-haspopup="dialog" onClick={() => setSearchOpen(true)}><Plus className="h-[18px] w-[18px]" strokeWidth={2.5} aria-hidden="true" />{t('teams.following.followBar')}</button>
          <Link to="/events" className="sp-link self-center">{eventIds.length || followed.profiles.length ? t('teams.following.anotherCompetition') : t('teams.following.chooseCompetition')}</Link>
        </>}
      </div>
      {searchOpen && (
        <Sheet title={t('teams.following.followBar')} className="fk-sheet" initialFocus="input[type=search]" onClose={() => setSearchOpen(false)}>
          {({ close }) => <SheetSearch search={search} onDone={close} />}
        </Sheet>
      )}
    </>
  );
}

function SheetSearch({ search, onDone }: { search: SearchProps; onDone: () => void }) {
  const t = useT();
  const [text, setText] = useState('');
  return <div className="flex flex-col gap-3">
    <RoundSearch label={t('teams.following.findToFollow')} placeholder={t('teams.following.findToFollow')} value={text} onChange={setText} />
    <ProfileSearchResults query={text} {...search} />
    <button type="button" className="kit-pill kit-pill-fill fk-show" onClick={() => onDone()}>{t('common.done')}</button>
  </div>;
}

/** Team profiles matching what was typed, each with a star to follow it on this device. */
function ProfileSearchResults({ query, profiles, error, retry, followedIds, onToggle }: SearchProps & { query: string }) {
  const t = useT();
  const needle = query.trim().toLowerCase();
  if (error && !profiles) return <Notice actionLabel={t('common.tryAgain')} onAction={retry}>{t('teams.following.profilesError')}</Notice>;
  if (!needle) return <p className="sp-note m-0">{t('teams.following.searchPrompt')}</p>;
  if (!profiles) return <p role="status" className="sp-note m-0">{t('teams.following.loadingEvent')}</p>;
  const found = profiles.filter((profile) => `${profile.displayName} ${profile.clubName}`.toLowerCase().includes(needle))
    .sort((a, b) => a.displayName.localeCompare(b.displayName)).slice(0, 30);
  if (!found.length) return <p className="sp-note m-0">{t('teams.following.noProfileMatch')}</p>;
  return <ul className="sp-card m-0 list-none p-0" aria-label={t('teams.following.followBar')}>
    {found.map((profile) => {
      const on = followedIds.has(profile.id);
      return <li key={profile.id}>
        <button type="button" className="sp-row !pr-1" aria-pressed={on} aria-label={t(on ? 'teams.unfollow' : 'teams.follow', { name: profile.displayName })} onClick={() => onToggle(profile)}>
          <span className="sp-grow"><span className="sp-t1">{profile.displayName}</span><span className="sp-t2">{profile.clubName}</span></span>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center text-[rgb(var(--mg-late-time))]"><FollowStar on={on} className="h-[22px] w-[22px]" /></span>
        </button>
      </li>;
    })}
  </ul>;
}

/**
 * `plain` is the site-level Following page: one short sentence when empty and a grey add bar, with no box.
 * `exclude` leaves out teams ("competition:team") that are shown another way; `quietWhenEmpty` drops the empty
 * sentence when something else on the page is followed; `addLink` is the choose-a-competition link.
 */
export function FollowingTeamsSection({ plain = false, exclude, quietWhenEmpty = false, addLink = true }: { plain?: boolean; exclude?: Set<string>; quietWhenEmpty?: boolean; addLink?: boolean }) {
  const t = useT();
  const { favourites: all, error } = useFavourites();
  const favourites = exclude ? all.filter((item) => !exclude.has(`${item.competitionId}:${item.teamId}`)) : all;
  const ids = [...new Set(favourites.map((item) => item.competitionId))];
  const [limit, setLimit] = useState(12);
  return <div className="flex flex-col gap-4">
    {error && <Notice>{error}</Notice>}
    {!ids.length && !quietWhenEmpty && (plain
      ? <p className="m-0 px-0.5 text-[15.5px] leading-relaxed text-[rgb(var(--mg-body))]">{t('teams.following.pageEmpty')}</p>
      : <div className="mg-card space-y-3 p-5"><h2 className="font-bold">{t('teams.following.noStarred')}</h2><p>{t('teams.following.openToStar')}</p></div>)}
    <div className="mg-cards-grid mg-cards-grid-2 flex flex-col gap-4 empty:hidden">
      {ids.slice(0, limit).map((id) => <FollowingEvent key={id} id={id} teamIds={favourites.filter((item) => item.competitionId === id).map((item) => item.teamId)} />)}
    </div>
    {ids.length > limit && <button className="mg-btn mg-btn-secondary" onClick={() => setLimit(limit + 12)}>{t('teams.following.moreEvents')}</button>}
    {addLink && (plain
      ? <Link to="/events" className="sp-add"><Plus className="h-[18px] w-[18px]" strokeWidth={2.5} aria-hidden="true" />{ids.length ? t('teams.following.anotherCompetition') : t('teams.following.chooseCompetition')}</Link>
      : <Link to="/events" className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-dashed border-[rgb(var(--mg-control))] bg-[rgb(var(--mg-surface))] text-sm font-semibold !text-[rgb(var(--mg-heading))]">
        <Plus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />{ids.length ? t('teams.following.anotherCompetition') : t('teams.following.chooseCompetition')}
      </Link>)}
  </div>;
}

function FollowingEvent({ id, teamIds }: { id: number; teamIds: number[] }) {
  const t = useT();
  const key = savedCopyKeys.competition(id);
  const [data, setData] = useState(() => readSavedCopy<CompetitionDetail>(key)?.data ?? null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { setMany } = useFavourites();
  useEffect(() => {
    const controller = new AbortController();
    api.get<CompetitionDetail>(`/competitions/${id}`, { signal: controller.signal, timeout: 15_000 })
      .then((response) => {
        if (controller.signal.aborted) return;
        setData(response.data); setError(false);
        if (serviceWorkerSavedAt(response.headers) === null) writeSavedCopy(key, response.data);
      }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [id, key, attempt]);
  const idKey = teamIds.join(',');
  const ids = useMemo(() => new Set(idKey.split(',').map(Number)), [idKey]);
  const next = useMemo(() => (data ? nextHeats(data, ids) : null), [data, ids]);
  const arenas = useMemo(() => (data ? arenaNames(data.sessions) : []), [data]);
  const now = new Date();
  const today = data ? isOnToday(data.startDate, data.endDate, now) : false;
  const live = !!data && today && data.sessions.some((session) => session.status === 1);
  const rows = data ? data.teams.filter((team) => ids.has(team.id)) : [];
  // Followed teams that the event no longer lists still count; they are cleaned up on the event's own page.
  const gone = data ? teamIds.filter((teamId) => !data.teams.some((team) => team.id === teamId)) : [];
  const missing = gone.length;
  return <section aria-label={data?.name ?? t('teams.following.competitionN', { id })}>
    <h2 className="sp-sec">
      <span>{data?.name ?? t('teams.following.competitionN', { id })}{live && <span className="ml-2 text-[rgb(var(--mg-red))]">{t('teams.following.liveCaps')}</span>}</span>
      {data && <small>{today ? t('common.today') : competitionDateText(data.startDate, data.endDate)}</small>}
    </h2>
    {!data && !error && <p role="status" className="sp-note">{t('teams.following.loadingEvent')}</p>}
    {error && <Notice actionLabel={t('common.tryAgain')} onAction={() => setAttempt(attempt + 1)}>{t('teams.following.refreshError')}</Notice>}
    {data && rows.length > 0 && <div className="sp-card">
      {rows.map((team) => {
        const summary = summariseNext(team, next?.get(team.id), arenas);
        return <Link key={team.id} to={`/competitions/${id}/teams/${team.id}`} className="sp-row">
          <span className="sp-grow"><span className="sp-t1">{team.displayName}</span><span className="sp-t2">{summary.sub}</span></span>
          <span className="sp-time"><span className="sp-num !min-w-0">{summary.time}</span><span className="sp-time-label">{summary.label}</span></span>
          <ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} />
        </Link>;
      })}
    </div>}
    {missing > 0 && <Notice tone="info" actionLabel={missing === 1 ? t('teams.following.removeIt') : t('teams.following.removeThem')} onAction={() => setMany(gone.map((teamId) => ({ competitionId: id, teamId })), false)}>
      {missing === 1 ? t('teams.following.goneOne') : t('teams.following.goneMany', { count: missing })}
    </Notice>}
  </section>;
}
