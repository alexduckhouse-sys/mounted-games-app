import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, Outlet } from 'react-router-dom';
import { api } from '../api';
import type { ChatMessage, CompetitionDetail, Session, Heat } from '../types';
import { tickerItems } from '../lib/ticker';
import { useTicker } from '../components/TickerContext';
import { useLiveHub } from '../live/useLiveHub';
import { CompetitionContext } from './competition/context';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { useNavExtras } from '../components/NavExtrasContext';

export function CompetitionPage() {
  const { id } = useParams<{ id: string }>();
  const competitionId = id ? Number(id) : null;
  if (competitionId == null || !Number.isSafeInteger(competitionId) || competitionId < 1) {
    return <Link to="/competitions">Select a competition</Link>;
  }
  return <CompetitionContent key={competitionId} competitionId={competitionId} />;
}

function CompetitionContent({ competitionId }: { competitionId: number }) {
  const [error, setError] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<CompetitionDetail | null>(null);
  const { setCurrent, setVenue } = useCurrentCompetition();

  const load = useCallback(() => setAttempt((n) => n + 1), []);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setError(false);
    api.get<CompetitionDetail>(`/competitions/${competitionId}`, { signal: controller.signal })
      .then((r) => {
        if (cancelled) return;
        setData(r.data);
        setSavedAt(r.headers['x-mg-saved-copy'] === '1' ? String(r.headers['x-mg-saved-at'] ?? '') : null);
      })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; controller.abort(); };
  }, [competitionId, attempt]);

  useEffect(() => {
    if (data) {
      setCurrent({ id: data.id, name: data.name });
      setVenue(data.latitude != null && data.longitude != null ? { competitionId: data.id, lat: data.latitude, lon: data.longitude } : null);
    }
  }, [data, setCurrent, setVenue]);

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
    setItems(data ? tickerItems(data.sessions, announcements, now, data.name) : []);
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
    },
    onResultsUpdated: (p) => {
      const payload = p as { sessionId: number; heat: Heat };
      setData((cur) => {
        if (!cur) return cur;
        const sessions = cur.sessions.map((s) => {
          if (s.id !== payload.sessionId) return s;
          const heats = s.heats.map((h) => (h.id === payload.heat.id ? payload.heat : h));
          return { ...s, heats };
        });
        return { ...cur, sessions };
      });
    },
  });

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
    <div className="card space-y-3 p-4" role="alert">
      <p>Couldn’t load this competition. Check your connection or choose another event.</p>
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary min-h-11" onClick={load}>Try again</button>
        <Link className="btn-ghost min-h-11" to="/competitions">Choose another competition</Link>
      </div>
    </div>
  );
  if (!data) return <p className="text-slate-500">Loading competition…</p>;

  return (
    <CompetitionContext.Provider value={{ competition: data, reload: load }}>
      <div className="space-y-3">
        <Outlet />
        {(savedAt !== null || error || !connected) && (
          <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            <p className="flex-1">
              {savedAt !== null ? `Last updated ${savedAt && !Number.isNaN(Date.parse(savedAt)) ? new Date(savedAt).toLocaleString('en-GB') : 'earlier'}.` : error ? 'Couldn’t refresh. Showing the last timetable received.' : 'Connecting to live updates. The timetable refreshes periodically while this page is open.'}
            </p>
            <button className="btn-ghost min-h-11" onClick={load}>Refresh</button>
          </div>
        )}
      </div>
    </CompetitionContext.Provider>
  );
}
