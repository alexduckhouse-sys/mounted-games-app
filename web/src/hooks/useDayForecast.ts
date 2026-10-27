import { useEffect, useState } from 'react';
import { api } from '../api';
import { isLiteModeActive } from '../lite/liteMode';
import { dayKey } from '../lib/timetableDay';
import { parseForecastHours, type ForecastHour } from '../lib/weatherAlert';

const MINUTE = 60_000;
const POLL_MS = 10 * MINUTE;
const LITE_POLL_MS = 20 * MINUTE;
/** Look again when the tab comes back after this long. */
const RECHECK_MS = 5 * MINUTE;
/** A forecast that can no longer be refreshed is dropped after this long, so the line never rests on old news. */
const STALE_MS = 60 * MINUTE;

/**
 * Today's hourly forecast for a place, kept fresh while `enabled`, for the organiser's weather line. It uses the
 * ordinary forecast endpoint (cached on the server for 30 minutes and by browsers for 10), so any number of organisers
 * cost the weather service the same. It fails quietly: errors, an offline phone and the API's fallback answer all
 * leave the last good forecast in place for up to an hour, then nothing.
 */
export function useDayForecast(lat: number | null | undefined, lon: number | null | undefined, enabled: boolean): ForecastHour[] | null {
  const key = lat != null && lon != null ? `${lat}|${lon}` : null;
  const [forecast, setForecast] = useState<{ key: string; hours: ForecastHour[] | null } | null>(null);

  useEffect(() => {
    if (!enabled || key == null || lat == null || lon == null) return;
    let cancelled = false;
    let lastGood = 0;
    let lastTry = 0;
    const controller = new AbortController();

    async function load() {
      lastTry = Date.now();
      try {
        const response = await api.get('/weather/forecast', { params: { lat, lon, date: dayKey(new Date()) }, signal: controller.signal });
        const hours = parseForecastHours(response.data);
        if (cancelled) return;
        if (hours) {
          lastGood = Date.now();
          setForecast({ key: key as string, hours });
          return;
        }
      } catch {
        // Fail quiet: no forecast means no weather line, not an error message.
      }
      if (!cancelled && Date.now() - lastGood > STALE_MS) setForecast({ key: key as string, hours: null });
    }

    void load();
    const timer = setInterval(() => void load(), isLiteModeActive() ? LITE_POLL_MS : POLL_MS);
    const recheck = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastTry >= RECHECK_MS) void load();
    };
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('online', recheck);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', recheck);
      window.removeEventListener('online', recheck);
    };
  }, [enabled, key, lat, lon]);

  return enabled && forecast?.key === key ? forecast.hours : null;
}
