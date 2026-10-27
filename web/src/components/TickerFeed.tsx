import { useEffect, useState } from 'react';
import { api } from '../api';
import type { ChatMessage, CompetitionDetail } from '../types';
import { bannerAsNew, tickerAnnouncements } from '../lib/announcements';
import { competitionPhase } from '../lib/competitionPhase';
import { tickerItems } from '../lib/ticker';
import { useLanguage } from '../i18n/LanguageContext';
import { useTicker } from './TickerContext';

const REFRESH_MS = 60_000;

/**
 * Keeps the ticker going away from an event's own pages (the events list, Following, Me, settings, admin) for the
 * event last opened. The event's pages feed it themselves from the live connection; here a fresh copy each minute
 * is enough, and none once every final is done or while the app is in the background.
 */
export function TickerFeed({ competitionId }: { competitionId: number }) {
  const { setItems } = useTicker();
  const { lang } = useLanguage();
  const [now, setNow] = useState(() => new Date());
  const [detail, setDetail] = useState<CompetitionDetail | null>(null);
  const [announcements, setAnnouncements] = useState<ChatMessage[]>([]);
  const finished = detail != null && competitionPhase(detail) === 'complete';

  useEffect(() => {
    if (finished) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') setNow(new Date());
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [finished]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    api.get<CompetitionDetail>(`/competitions/${competitionId}`, { signal })
      .then((r) => { if (Array.isArray(r.data?.sessions) && Array.isArray(r.data.sections)) setDetail(r.data); })
      .catch(() => {});
    api.get<ChatMessage[]>(`/competitions/${competitionId}/chat`, { signal })
      .then((r) => { if (Array.isArray(r.data)) setAnnouncements(tickerAnnouncements(r.data)); })
      .catch(() => {});
    return () => controller.abort();
  }, [competitionId, now]);

  useEffect(() => {
    setItems(detail ? tickerItems(detail.sessions, bannerAsNew(announcements, now), now) : []);
    // The lines are worded in the chosen language, so a change of language rebuilds them.
  }, [detail, announcements, now, setItems, lang]);
  useEffect(() => () => setItems([]), [setItems]);

  return null;
}
