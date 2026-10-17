import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams, Outlet } from 'react-router-dom';
import { api } from '../api';
import type { ChatMessage, CompetitionDetail, Session, Heat } from '../types';
import { tickerItems } from '../lib/ticker';
import { useTicker } from '../components/TickerContext';
import { useLiveHub } from '../live/useLiveHub';
import { HEAT_SAVED } from '../offline/useScoreOutbox';
import { ScoreOutboxPanel } from '../components/ScoreOutboxPanel';
import { applyResultsUpdate, replaceHeat, type ResultsUpdate } from '../lib/liveUpdates';
import { CompetitionContext } from './competition/context';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { useNavExtras } from '../components/NavExtrasContext';
import { useAgeGroups } from '../components/AgeGroupsContext';
import { useCompetitionMeta } from '../components/competitionMeta';
import { displaySectionName } from '../lib/section';
import { readSavedCopy, savedCopyKeys, serviceWorkerSavedAt, writeSavedCopy } from '../offline/savedCopies';
import { PageSkeleton, TimetableSkeleton, ToplistSkeleton } from '../components/Skeletons';

export function CompetitionPage() {
  const { id } = useParams<{ id: string }>();
  const competitionId = id ? Number(id) : null;
  if (competitionId == null || !Number.isSafeInteger(competitionId) || competitionId < 1) {
    return <p className="pt-6"><Link className="mg-text-link" to="/competitions">Select a competition</Link></p>;
  }
  return <CompetitionContent key={competitionId} competitionId={competitionId} />;
}

function CompetitionContent({ competitionId }: { competitionId: number }) {
  const savedKey = savedCopyKeys.competition(competitionId);
  // Open straight away on the copy this phone saw last, then refresh it from the server.
  const [initial] = useState(() => readSavedCopy<CompetitionDetail>(savedKey));
  const [error, setError] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(initial?.savedAt ?? null);
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<CompetitionDetail | null>(initial?.data ?? null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(initial ? new Date(initial.savedAt) : null);
  // Which load has finished and which has run past two seconds; the current one is `attempt`.
  const [settledAttempt, setSettledAttempt] = useState(-1);
  const [slowAttempt, setSlowAttempt] = useState(-1);
  /** How current `data` is, so a staler service-worker fallback never replaces it. */
  const dataAt = useRef(initial ? Date.parse(initial.savedAt) : 0);
  const { setCurrent, setVenue } = useCurrentCompetition();
  const { pathname } = useLocation();

  const load = useCallback(() => setAttempt((n) => n + 1), []);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setError(false);
    const slowTimer = setTimeout(() => setSlowAttempt(attempt), 2_000);
    api.get<CompetitionDetail>(`/competitions/${competitionId}`, { signal: controller.signal })
      .then((r) => {
        if (cancelled) return;
        const fallback = serviceWorkerSavedAt(r.headers);
        if (fallback === null) {
          dataAt.current = Date.now();
          setData(r.data);
          setSavedAt(null);
          setUpdatedAt(new Date());
          return;
        }
        const fallbackAt = fallback === 'unknown' ? 0 : fallback.getTime();
        if (dataAt.current > 0 && dataAt.current >= fallbackAt) return; // ours is newer: keep showing it
        dataAt.current = fallbackAt;
        setData(r.data);
        setSavedAt(fallback === 'unknown' ? '' : fallback.toISOString());
        setUpdatedAt(fallback === 'unknown' ? null : fallback);
      })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => {
        clearTimeout(slowTimer);
        if (!cancelled) setSettledAttempt(attempt);
      });
    return () => { cancelled = true; clearTimeout(slowTimer); controller.abort(); };
  }, [competitionId, attempt]);

  // Keep the saved copy in step with every change, live results included, so it is never older than the screen.
  useEffect(() => {
    if (!data || data === initial?.data) return;
    const timer = setTimeout(() => writeSavedCopy(savedKey, data, new Date(dataAt.current || Date.now())), 500);
    return () => clearTimeout(timer);
  }, [data, initial, savedKey]);

  useEffect(() => {
    if (data) {
      setCurrent({ id: data.id, name: data.name });
      setVenue(data.latitude != null && data.longitude != null ? { competitionId: data.id, lat: data.latitude, lon: data.longitude } : null);
    }
  }, [data, setCurrent, setVenue]);

  const { setMeta } = useCompetitionMeta();
  useEffect(() => {
    if (data) setMeta({ id: data.id, name: data.name, startDate: data.startDate, endDate: data.endDate, location: data.location, live: data.sessions.some((s) => s.status === 1) });
  }, [data, setMeta]);
  useEffect(() => () => setMeta(null), [setMeta]);

  const { setGroups } = useAgeGroups();
  useEffect(() => {
    if (data) setGroups(data.id, data.sections.map((s) => ({ id: s.id, name: displaySectionName(s.displayName) })));
    return () => setGroups(null, []);
  }, [data, setGroups]);

  const { setExtras, clear } = useNavExtras();
  useEffect(() => {
    setExtras([]);
    return () => clear();
  }, [competitionId, setExtras, clear]);

  const { setItems } = useTicker();
  const [announcements, setAnnouncements] = useState<ChatMessage[]>([]);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    api.get<ChatMessage[]>(`/competitions/${competitionId}/chat`, { signal: controller.signal })
      .then((r) => setAnnouncements(r.data.filter((m) => m.type === 2)))
      .catch(() => {});
    return () => controller.abort();
  }, [competitionId, attempt]);
  useEffect(() => {
    // No name fallback: the header already shows it, so the strip stays hidden when there is no news.
    setItems(data ? tickerItems(data.sessions, announcements, now) : []);
    return () => setItems([]);
  }, [data, announcements, now, setItems]);

  const { connected } = useLiveHub(competitionId, {
    onReady: load,
    onAnnouncement: (m) => setAnnouncements((cur) => [...cur.filter((x) => x.id !== (m as ChatMessage).id), m as ChatMessage]),
    onSessionUpdated: (s) => {
      const updated = s as Session;
      setData((cur) => {
        if (!cur) return cur;
        const sessions = cur.sessions.map((x) => (x.id === updated.id ? updated : x));
        return { ...cur, sessions };
      });
      dataAt.current = Date.now();
      setUpdatedAt(new Date());
    },
    onResultsUpdated: (p) => {
      setData((cur) => (cur ? applyResultsUpdate(cur, p as ResultsUpdate) : cur));
      dataAt.current = Date.now();
      setUpdatedAt(new Date());
    },
  });

  const applyHeat = useCallback((sessionId: number, heat: Heat) => {
    setData((cur) => (cur ? replaceHeat(cur, sessionId, heat) : cur));
    dataAt.current = Date.now();
  }, []);

  // Results sent from this phone's outbox show straight away, live link or not.
  useEffect(() => {
    const onSaved = (e: Event) => {
      const { sessionId, heat } = (e as CustomEvent<{ sessionId: number; heat: Heat }>).detail;
      applyHeat(sessionId, heat);
    };
    window.addEventListener(HEAT_SAVED, onSaved);
    return () => window.removeEventListener(HEAT_SAVED, onSaved);
  }, [applyHeat]);

  useEffect(() => {
    function refresh() { if (navigator.onLine && document.visibilityState === 'visible') load(); }
    window.addEventListener('online', refresh);
    navigator.serviceWorker?.addEventListener('controllerchange', refresh);
    document.addEventListener('visibilitychange', refresh);
    const timer = !connected ? setInterval(refresh, 30_000) : undefined;
    return () => {
      window.removeEventListener('online', refresh);
      navigator.serviceWorker?.removeEventListener('controllerchange', refresh);
      document.removeEventListener('visibilitychange', refresh);
      if (timer !== undefined) clearInterval(timer);
    };
  }, [connected, load]);

  if (error && !data) return (
    <div className="mg-card mx-auto mt-6 flex max-w-xl flex-col gap-3 p-4" role="alert">
      <p>Couldn’t load this competition. Check your connection or choose another event.</p>
      <div className="flex flex-wrap gap-2">
        <button className="mg-btn mg-btn-primary" onClick={load}>Try again</button>
        <Link className="mg-btn mg-btn-secondary" to="/competitions">Choose another competition</Link>
      </div>
    </div>
  );
  if (!data) {
    if (/\/(?:toplists|scoring)\/?$/.test(pathname)) return <ToplistSkeleton />;
    return /\/competitions\/\d+\/?$/.test(pathname) ? <TimetableSkeleton /> : <PageSkeleton />;
  }
  // A saved copy only needs a notice once the refresh is slow or has failed; a quick refresh just replaces it.
  const refreshing = settledAttempt !== attempt;
  const showSavedNotice = savedAt !== null && (slowAttempt === attempt || !refreshing);

  return (
    <CompetitionContext.Provider value={{ competition: data, reload: load, updatedAt, isStale: savedAt !== null || error || !connected }}>
      <div className="flex flex-col gap-4">
        <div className="pt-4 empty:hidden"><ScoreOutboxPanel competitionId={data.id} /></div>
        <Outlet />
        {(showSavedNotice || error || !connected) && (
          <div role="status" className="mg-notice mx-auto flex w-full max-w-xl flex-wrap items-center gap-2">
            <p className="flex-1">
              {showSavedNotice ? `Last updated ${savedAt && !Number.isNaN(Date.parse(savedAt)) ? new Date(savedAt).toLocaleString('en-GB') : 'earlier'}.${refreshing ? ' Checking for changes…' : ''}` : error ? 'Couldn’t refresh. Showing the last timetable received.' : 'Connecting to live updates. The timetable refreshes periodically while this page is open.'}
            </p>
            <button className="mg-btn mg-btn-secondary !min-h-11" onClick={load}>Refresh</button>
          </div>
        )}
      </div>
    </CompetitionContext.Provider>
  );
}
