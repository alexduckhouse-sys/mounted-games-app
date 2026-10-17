import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { useFavourites } from '../hooks/useFavourites';
import { readSavedCopy, savedCopyKeys, serviceWorkerSavedAt, writeSavedCopy } from '../offline/savedCopies';
import type { CompetitionDetail } from '../types';

export function FollowingPage() {
  const { favourites } = useFavourites();
  const { current } = useCurrentCompetition();
  const ids = [...new Set(favourites.map((item) => item.competitionId))];
  const [limit, setLimit] = useState(12);
  return <div className="mx-auto max-w-2xl space-y-4 py-5">
    <h1 className="mg-h1 mg-h1-sm">Following</h1>
    <p className="mg-meta">Your starred teams, saved on this device. Open an event for their next heats and latest scores.</p>
    {current && <Link className="mg-btn mg-btn-primary" to={`/competitions/${current.id}/following`}>Choose teams at {current.name}</Link>}
    {!ids.length && <div className="mg-card space-y-3 p-5"><h2 className="font-bold">No starred teams yet</h2><p>Open a competition and star the teams you want to follow.</p><Link className="mg-text-link" to="/competitions">Choose a competition</Link></div>}
    {ids.slice(0, limit).map((id) => <FollowingEvent key={id} id={id} count={favourites.filter((item) => item.competitionId === id).length} />)}
    {ids.length > limit && <button className="mg-btn mg-btn-secondary" onClick={() => setLimit(limit + 12)}>Show more events</button>}
  </div>;
}

function FollowingEvent({ id, count }: { id: number; count: number }) {
  const key = savedCopyKeys.competition(id);
  const [data, setData] = useState(() => readSavedCopy<CompetitionDetail>(key)?.data ?? null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { favourites, toggle, error: storageError } = useFavourites();
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
  return <section className="mg-card space-y-2 p-4">
    <Link className="mg-text-link text-lg font-bold" to={`/competitions/${id}/following`}>{data?.name ?? `Competition ${id}`}</Link>
    <p className="mg-meta">{count} starred {count === 1 ? 'team' : 'teams'}{data ? ` · ${new Date(data.startDate).toLocaleDateString('en-GB')}` : ''}</p>
    {!data && !error && <p role="status">Loading event…</p>}
    {error && <p role="alert">Couldn’t refresh this event. <button className="mg-text-link min-h-11" onClick={() => setAttempt(attempt + 1)}>Try again</button></p>}
    {storageError && <p role="alert">{storageError}</p>}
    <details><summary className="min-h-11 cursor-pointer py-2 text-sm">Manage saved teams</summary>
      {favourites.filter((item) => item.competitionId === id).map((item) => <button key={item.teamId} className="mg-btn mg-btn-secondary m-1" onClick={() => toggle(item)}>Unfollow {data?.teams.find((team) => team.id === item.teamId)?.displayName ?? `team ${item.teamId}`}</button>)}
    </details>
  </section>;
}
