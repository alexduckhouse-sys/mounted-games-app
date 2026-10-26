import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Plus } from 'lucide-react';
import { api } from '../api';
import { usePageWidth } from '../components/pageWidthState';
import { usePageHeader } from '../components/CompactPageBarContext';
import { Notice } from '../components/Notice';
import { useFavourites } from '../hooks/useFavourites';
import { competitionDateText, isOnToday } from '../lib/competitionDates';
import { arenaNames, nextHeats, summariseNext } from '../lib/following';
import { readSavedCopy, savedCopyKeys, serviceWorkerSavedAt, writeSavedCopy } from '../offline/savedCopies';
import type { CompetitionDetail } from '../types';
import '../components/sitePages.css';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function FollowingPage() {
  usePageWidth('wide');
  const { favourites } = useFavourites();
  const ids = [...new Set(favourites.map((item) => item.competitionId))];
  usePageHeader({ title: 'Following', subtitle: favourites.length ? `${plural(favourites.length, 'team')} · ${plural(ids.length, 'event')}` : undefined, plain: true });
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 pb-2 pt-3 lg:max-w-none">
      <FollowingTeamsSection plain />
    </div>
  );
}

/** `plain` is the site-level Following page: one short sentence when empty and a grey add bar, with no box. */
export function FollowingTeamsSection({ plain = false }: { plain?: boolean }) {
  const { favourites, error } = useFavourites();
  const ids = [...new Set(favourites.map((item) => item.competitionId))];
  const [limit, setLimit] = useState(12);
  return <div className="flex flex-col gap-4">
    {error && <Notice>{error}</Notice>}
    {!ids.length && (plain
      ? <p className="m-0 px-0.5 text-[15.5px] leading-relaxed text-[rgb(var(--mg-body))]">Star teams at a competition and they show up here with their next heats.</p>
      : <div className="mg-card space-y-3 p-5"><h2 className="font-bold">No starred teams yet</h2><p>Open a competition and star the teams you want to follow.</p></div>)}
    <div className="mg-cards-grid mg-cards-grid-2 flex flex-col gap-4 empty:hidden">
      {ids.slice(0, limit).map((id) => <FollowingEvent key={id} id={id} teamIds={favourites.filter((item) => item.competitionId === id).map((item) => item.teamId)} />)}
    </div>
    {ids.length > limit && <button className="mg-btn mg-btn-secondary" onClick={() => setLimit(limit + 12)}>Show more events</button>}
    {plain
      ? <Link to="/events" className="sp-add"><Plus className="h-[18px] w-[18px]" strokeWidth={2.5} aria-hidden="true" />{ids.length ? 'Follow teams at another competition' : 'Choose a competition'}</Link>
      : <Link to="/events" className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-dashed border-[rgb(var(--mg-control))] bg-[rgb(var(--mg-surface))] text-sm font-semibold !text-[rgb(var(--mg-heading))]">
        <Plus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />{ids.length ? 'Follow teams at another competition' : 'Choose a competition'}
      </Link>}
  </div>;
}

function FollowingEvent({ id, teamIds }: { id: number; teamIds: number[] }) {
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
  return <section aria-label={data?.name ?? `Competition ${id}`}>
    <h2 className="sp-sec">
      <span>{data?.name ?? `Competition ${id}`}{live && <span className="ml-2 text-[rgb(var(--mg-red))]">LIVE</span>}</span>
      {data && <small>{today ? 'Today' : competitionDateText(data.startDate, data.endDate)}</small>}
    </h2>
    {!data && !error && <p role="status" className="sp-note">Loading event…</p>}
    {error && <Notice actionLabel="Try again" onAction={() => setAttempt(attempt + 1)}>Couldn’t refresh this event. Check your signal and try again.</Notice>}
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
    {missing > 0 && <Notice tone="info" actionLabel={missing === 1 ? 'Remove it' : 'Remove them'} onAction={() => setMany(gone.map((teamId) => ({ competitionId: id, teamId })), false)}>
      {missing === 1 ? 'A team you follow is no longer at this event.' : `${missing} teams you follow are no longer at this event.`}
    </Notice>}
  </section>;
}
