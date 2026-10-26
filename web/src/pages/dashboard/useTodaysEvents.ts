import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { isOnToday } from '../../lib/competitionDates';
import type { CompetitionPickerItem, CompetitionPickerPage } from '../../types';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface TodaysEvents {
  /** True once the list has come back (or failed), so "nothing on" is never shown while still asking. */
  loaded: boolean;
  /** Running today. */
  today: CompetitionPickerItem[];
  /** Running today or starting within the next seven days, soonest first. */
  week: CompetitionPickerItem[];
  /** Every competition still to come or running, soonest first (the first page the picker returns). */
  upcoming: CompetitionPickerItem[];
  /** The event quick actions point at: one with a heat on now, else the first today, else the first this week. */
  focus: CompetitionPickerItem | null;
}

/** The competitions running today or this week, from the same picker the Events page uses. */
export function useTodaysEvents(enabled = true): TodaysEvents {
  const [items, setItems] = useState<CompetitionPickerItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const now = useMemo(() => new Date(), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    api.get<CompetitionPickerPage>('/competitions/picker', { params: { past: false, page: 1 } })
      .then(({ data }) => {
        if (cancelled) return;
        if (Array.isArray(data?.items)) setItems(data.items); else setFailed(true);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [enabled]);

  return useMemo(() => {
    const all = items ?? [];
    const today = all.filter((item) => isOnToday(item.startDate, item.endDate, now));
    const week = all.filter((item) => {
      if (today.includes(item)) return true;
      const start = new Date(item.startDate).getTime();
      return start > now.getTime() && start - now.getTime() <= WEEK_MS;
    });
    const focus = today.find((item) => item.live) ?? today[0] ?? week[0] ?? null;
    return { loaded: items != null || failed, today, week, upcoming: all, focus };
  }, [items, failed, now]);
}
