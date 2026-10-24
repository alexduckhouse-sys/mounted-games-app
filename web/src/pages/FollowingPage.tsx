import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Star } from 'lucide-react';
import { api } from '../api';
import { usePageWidth } from '../components/pageWidthState';
import { usePageHeader } from '../components/CompactPageBarContext';
import { useFavourites } from '../hooks/useFavourites';
import { competitionDateText, isOnToday } from '../lib/competitionDates';
import { arenaNames, nextHeats, summariseNext } from '../lib/following';
import { readSavedCopy, savedCopyKeys, serviceWorkerSavedAt, writeSavedCopy } from '../offline/savedCopies';
import type { CompetitionDetail } from '../types';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const TIME_COLOUR = { ok: 'text-[rgb(var(--mg-heading))]', late: 'text-[rgb(var(--mg-late-time))]', live: 'text-[rgb(var(--mg-red))]', wait: 'text-[rgb(var(--mg-faint))]' } as const;

export function FollowingPage() {
  usePageWidth('wide');
  const { favourites } = useFavourites();
  const ids = [...new Set(favourites.map((item) => item.competitionId))];
  usePageHeader({ title: 'Following', subtitle: favourites.length ? `${plural(favourites.length, 'team')} · ${plural(ids.length, 'event')}` : undefined, plain: true });
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 pb-2 pt-3 lg:max-w-none">
      <FollowingTeamsSection />
    </div>
  );
}

export function FollowingTeamsSection() {
  const { favourites, error } = useFavourites();
  const ids = [...new Set(favourites.map((item) => item.competitionId))];
  const [limit, setLimit] = useState(12);
  return <div className="flex flex-col gap-4">
    {error && <p role="alert" className="mg-notice">{error}</p>}
    {!ids.length && <div className="mg-card space-y-3 p-5"><h2 className="font-bold">No starred teams yet</h2><p>Open a competition and star the teams you want to follow. Stars are saved on this device.</p></div>}
    <div className="mg-cards-grid mg-cards-grid-2 flex flex-col gap-4 empty:hidden">
      {ids.slice(0, limit).map((id) => <FollowingEvent key={id} id={id} teamIds={favourites.filter((item) => item.competitionId === id).map((item) => item.teamId)} />)}
    </div>
    {ids.length > limit && <button className="mg-btn mg-btn-secondary" onClick={() => setLimit(limit + 12)}>Show more events</button>}
    <Link to="/events" className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-dashed border-[rgb(var(--mg-control))] bg-[rgb(var(--mg-surface))] text-sm font-semibold !text-[rgb(var(--mg-heading))]">
      <Plus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />{ids.length ? 'Follow teams at another event' : 'Choose a competition'}
    </Link>
  </div>;
}

function FollowingEvent({ id, teamIds }: { id: number; teamIds: number[] }) {
  const key = savedCopyKeys.competition(id);
  const [data, setData] = useState(() => readSavedCopy<CompetitionDetail>(key)?.data ?? null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
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
  const missing = data ? teamIds.length - rows.length : 0;
  return <section className="mg-sec" aria-label={data?.name ?? `Competition ${id}`}>
    <div className="mg-sec-head">
      <h2>{data?.name ?? `Competition ${id}`}</h2>
      {live && <span className="!font-bold !tracking-[0.06em] text-[rgb(var(--mg-red))]">LIVE</span>}
      {data && <span>{today ? 'Today' : competitionDateText(data.startDate, data.endDate)}</span>}
    </div>
    {!data && !error && <p role="status" className="mg-meta px-1">Loading event…</p>}
    {error && <p role="alert" className="mg-notice">Couldn’t refresh this event. <button className="mg-text-link !min-h-11 !inline-flex" onClick={() => setAttempt(attempt + 1)}>Try again</button></p>}
    {data && <div className="mg-lines">
      {rows.map((team) => {
        const summary = summariseNext(team, next?.get(team.id), arenas);
        return <Link key={team.id} to={`/competitions/${id}/following`} className={`mg-line grid-cols-[20px_minmax(0,1fr)_auto] !min-h-[52px] ${summary.tone === 'late' ? 'mg-line-late' : ''}`}>
          <Star className="h-[18px] w-[18px] fill-[#C08308] text-[#C08308]" aria-hidden="true" />
          <span className="flex min-w-0 flex-col gap-0.5"><strong className="mg-line-title">{team.displayName}</strong><span className="mg-line-sub">{summary.sub}</span></span>
          <span className="flex flex-col items-end gap-0.5"><span className={`mg-line-time ${TIME_COLOUR[summary.tone]}`}>{summary.time}</span><span className="text-[10px] font-semibold uppercase leading-none tracking-[0.06em] text-[rgb(var(--mg-muted))]">{summary.label}</span></span>
        </Link>;
      })}
      {missing > 0 && <Link to={`/competitions/${id}/following`} className="mg-line !grid-cols-[minmax(0,1fr)] text-sm">
        <span className="mg-meta">{plural(missing, 'followed team')} no longer listed at this event. Open it to tidy up.</span>
      </Link>}
    </div>}
  </section>;
}
