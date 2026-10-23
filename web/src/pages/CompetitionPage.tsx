import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams, Outlet } from 'react-router-dom';
import { api } from '../api';
import type { ChatMessage, CompetitionDetail, Session, Heat } from '../types';
import { useCompetitionStreams } from '../hooks/useCompetitionStreams';
import { useStreamOverlay } from '../hooks/useStreamOverlay';
import { useSponsorFeed } from '../hooks/useSponsorFeed';
import { appendStreamMessage } from '../lib/streams';
import { tickerItems } from '../lib/ticker';
import { useTicker } from '../components/TickerContext';
import { useLiveHub } from '../live/useLiveHub';
import { useConnectionStatus } from '../live/ConnectionStatusContext';
import { isFocusPage, pollIntervalMs } from '../live/connectionStatus';
import { useDownSince } from '../live/useDownSince';
import { HEAT_SAVED } from '../offline/useScoreOutbox';
import { ScoreOutboxPanel } from '../components/ScoreOutboxPanel';
import { applyResultsUpdate, replaceHeat, type ResultsUpdate } from '../lib/liveUpdates';
import { applyScoreCardControl, parseScoreCardControl, queueScoreCard, type QueuedScoreCard } from '../lib/scoreCard';
import { CompetitionContext } from './competition/context';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { useNavExtras } from '../components/NavExtrasContext';
import { useAgeGroups } from '../components/AgeGroupsContext';
import { useCompetitionMeta } from '../components/competitionMeta';
import { displaySectionName } from '../lib/section';
import { readSavedCopy, savedCopyKeys, serviceWorkerSavedAt, writeSavedCopy } from '../offline/savedCopies';
import { PageSkeleton, TimetableSkeleton, ToplistSkeleton } from '../components/Skeletons';
import { DemoEventNotice } from '../components/DemoEventNotice';

const BANNER_TAG = 'banner';

function currentAnnouncements(messages: ChatMessage[]) {
  const announcements = messages.filter((message) => message.type === 2);
  const activeBanner = announcements.filter((message) => message.tag === BANNER_TAG).at(-1);
  return [...announcements.filter((message) => message.tag !== BANNER_TAG), ...(activeBanner ? [activeBanner] : [])];
}

function addAnnouncement(current: ChatMessage[], message: ChatMessage) {
  const withoutSame = current.filter((item) => item.id !== message.id);
  return message.tag === BANNER_TAG
    ? [...withoutSame.filter((item) => item.tag !== BANNER_TAG), message]
    : [...withoutSame, message];
}

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
  const [failedAttempt, setFailedAttempt] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(initial?.savedAt ?? null);
  const [attempt, setAttempt] = useState(0);
  const error = failedAttempt === attempt;
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
  /** Showing the small first view while the full timetable is still on its way. */
  const [partial, setPartial] = useState(false);
  /** Timetable checks that failed in a row; a service-worker copy counts as a failure. */
  const [failures, setFailures] = useState(0);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const slowTimer = setTimeout(() => setSlowAttempt(attempt), 2_000);
    api.get<CompetitionDetail>(`/competitions/${competitionId}`, { signal: controller.signal })
      .then((r) => {
        if (cancelled) return;
        const fallback = serviceWorkerSavedAt(r.headers);
        if (fallback === null) {
          setFailures(0);
          dataAt.current = Date.now();
          setData(r.data);
          setPartial(false);
          setSavedAt(null);
          setUpdatedAt(new Date());
          return;
        }
        setFailures((n) => n + 1);
        const fallbackAt = fallback === 'unknown' ? 0 : fallback.getTime();
        if (dataAt.current > 0 && dataAt.current >= fallbackAt) return; // ours is newer: keep showing it
        dataAt.current = fallbackAt;
        setData(r.data);
        setPartial(false);
        setSavedAt(fallback === 'unknown' ? '' : fallback.toISOString());
        setUpdatedAt(fallback === 'unknown' ? null : fallback);
      })
      .catch(() => {
        if (cancelled) return;
        setFailedAttempt(attempt);
        setFailures((n) => n + 1);
      })
      .finally(() => {
        clearTimeout(slowTimer);
        if (!cancelled) { setSettledAttempt(attempt); setRetrying(false); }
      });
    return () => { cancelled = true; clearTimeout(slowTimer); controller.abort(); };
  }, [competitionId, attempt]);

  // With nothing saved on this phone, ask for the small first view too: on one bar it arrives well before the
  // full timetable, and the full one replaces it. A saved copy already opens straight away, so skip it then.
  useEffect(() => {
    if (initial) return;
    const controller = new AbortController();
    api.get<CompetitionDetail>(`/competitions/${competitionId}/first-view`, { signal: controller.signal })
      .then((r) => {
        if (dataAt.current > 0 || serviceWorkerSavedAt(r.headers) !== null) return;
        setData(r.data);
        setPartial(true);
      })
      .catch(() => { /* the full timetable is still coming */ });
    return () => controller.abort();
  }, [competitionId, initial]);

  // Keep the saved copy in step with every change, live results included, so it is never older than the screen.
  // The first view is only part of the timetable, so it is never saved.
  useEffect(() => {
    if (!data || data === initial?.data || partial) return;
    const timer = setTimeout(() => writeSavedCopy(savedKey, data, new Date(dataAt.current || Date.now())), 500);
    return () => clearTimeout(timer);
  }, [data, initial, partial, savedKey]);

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

  const { setItems, setWatchCompetitionId } = useTicker();
  const [ready, setReady] = useState(0);
  const streamState = useCompetitionStreams(competitionId, ready);
  const overlayState = useStreamOverlay(competitionId, ready);
  const sponsorFeed = useSponsorFeed(competitionId, ready);
  // Score cards are worked out from what this phone held before each results update.
  const latestData = useRef(data);
  useEffect(() => { latestData.current = data; }, [data]);
  const [scoreCards, setScoreCards] = useState<QueuedScoreCard[]>([]);
  const [streamMessages, setStreamMessages] = useState<{ message: ChatMessage; receivedAt: number }[]>([]);
  const addStreamMessage = (value: unknown) => {
    const message = value as ChatMessage;
    if (message.competitionId !== competitionId) return;
    setStreamMessages((current) => appendStreamMessage(current, { message, receivedAt: Date.now() }));
  };
  const hasStreams = streamState.streams.length > 0;
  useEffect(() => {
    setWatchCompetitionId(hasStreams ? competitionId : null);
    return () => setWatchCompetitionId(null);
  }, [hasStreams, competitionId, setWatchCompetitionId]);
  const [announcements, setAnnouncements] = useState<ChatMessage[]>([]);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    api.get<ChatMessage[]>(`/competitions/${competitionId}/chat`, { signal: controller.signal })
      .then((r) => setAnnouncements(currentAnnouncements(r.data)))
      .catch(() => {});
    return () => controller.abort();
  }, [competitionId, attempt]);
  useEffect(() => {
    // No name fallback: the header already shows it, so the strip stays hidden when there is no news.
    const activeBanner = announcements.filter((message) => message.tag === BANNER_TAG).at(-1);
    const tickerAnnouncements = activeBanner
      ? announcements.map((message) => message.id === activeBanner.id ? { ...message, createdAt: now.toISOString() } : message)
      : announcements;
    setItems(data ? tickerItems(data.sessions, tickerAnnouncements, now) : []);
    return () => setItems([]);
  }, [data, announcements, now, setItems]);

  const { connected, invoke, reconnect } = useLiveHub(competitionId, {
    onReady: () => { load(); setReady((value) => value + 1); },
    onStreamUpdated: streamState.onStreamUpdated,
    onStreamViewers: streamState.onStreamViewers,
    onOverlayUpdated: overlayState.onOverlayUpdated,
    onSponsorControl: sponsorFeed.onSponsorControl,
    onScoreCardControl: (raw) => {
      const control = parseScoreCardControl(raw);
      if (control) setScoreCards((cards) => applyScoreCardControl(cards, control, Date.now(), overlayState.overlay.scoreCardDelaySeconds * 1000));
    },
    onChatMessage: addStreamMessage,
    onAnnouncement: (m) => {
      const message = m as ChatMessage;
      addStreamMessage(message);
      if (message.competitionId === competitionId) setAnnouncements((current) => addAnnouncement(current, message));
    },
    onChatMessageDeleted: ({ id }) => {
      setAnnouncements((current) => current.filter((message) => message.id !== id));
      setStreamMessages((current) => current.filter((item) => item.message.id !== id));
    },
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
      const update = p as ResultsUpdate;
      const queued = 'heat' in update && update.heat ? queueScoreCard(latestData.current, update.sessionId, update.heat, Date.now()) : null;
      if (queued) setScoreCards((cards) => [...cards.slice(-4), queued]);
      setData((cur) => (cur ? applyResultsUpdate(cur, update) : cur));
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

  // Without the live link, check for changes on a timer: unchanged timetables come back as a 304, so this is cheap.
  const intervalMs = pollIntervalMs(isFocusPage(pathname), failures);
  useEffect(() => {
    function refresh() { if (navigator.onLine && document.visibilityState === 'visible') load(); }
    window.addEventListener('online', refresh);
    navigator.serviceWorker?.addEventListener('controllerchange', refresh);
    document.addEventListener('visibilitychange', refresh);
    const timer = !connected ? setInterval(refresh, intervalMs) : undefined;
    return () => {
      window.removeEventListener('online', refresh);
      navigator.serviceWorker?.removeEventListener('controllerchange', refresh);
      document.removeEventListener('visibilitychange', refresh);
      if (timer !== undefined) clearInterval(timer);
    };
  }, [connected, intervalMs, load]);

  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // Tell the header's connection pill what is happening.
  const retry = useCallback(() => { setRetrying(true); load(); reconnect(); }, [load, reconnect]);
  const { setStatus } = useConnectionStatus();
  const { downSince, everConnected } = useDownSince(connected);
  useEffect(() => {
    setStatus({ connected, online, failures, downSince, everConnected, updatedAt, intervalMs, retrying, retry });
  }, [connected, online, failures, downSince, everConnected, updatedAt, intervalMs, retrying, retry, setStatus]);
  useEffect(() => () => setStatus(null), [setStatus]);

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
    <CompetitionContext.Provider value={{ competition: data, reload: load, updatedAt, isStale: savedAt !== null || error || !connected, streams: streamState.streams, streamingEnabled: streamState.streamingEnabled, invoke, ready, streamMessages, overlay: overlayState.overlay, saveOverlay: overlayState.save, scoreCards, sponsors: sponsorFeed.sponsors, reloadSponsors: sponsorFeed.reloadSponsors, sponsorSkip: sponsorFeed.sponsorSkip }}>
      <div className="flex flex-col gap-4">
        <div className="pt-4 empty:hidden"><ScoreOutboxPanel competitionId={data.id} /></div>
        {data.isDemo && <DemoEventNotice />}
        <Outlet />
        {partial && <p role="status" className="mg-notice mx-auto w-full max-w-xl">Loading the rest of the timetable…</p>}
        {/* Connection trouble is shown by the pill in the header; this only explains a saved copy. */}
        {showSavedNotice && (
          <div role="status" className="mg-notice mx-auto flex w-full max-w-xl flex-wrap items-center gap-2">
            <p className="flex-1">
              {`Last updated ${savedAt && !Number.isNaN(Date.parse(savedAt)) ? new Date(savedAt).toLocaleString('en-GB') : 'earlier'}.${refreshing ? ' Checking for changes…' : ''}`}
            </p>
            <button className="mg-btn mg-btn-secondary !min-h-11" onClick={load}>Refresh</button>
          </div>
        )}
      </div>
    </CompetitionContext.Provider>
  );
}
