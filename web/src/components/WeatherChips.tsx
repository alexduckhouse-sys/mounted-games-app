import { useEffect, useState } from 'react';
import { Cloud, CloudRain, CloudSnow, Sun, CloudFog, CloudLightning, Moon } from 'lucide-react';
import { api } from '../api';

interface AtResponse {
  hour?: string;
  temperature_2m?: number;
  weather_code?: number;
  is_day?: number;
  fallback?: { temperature_2m?: number; weather_code?: number; is_day?: number };
}
interface CurrentResponse {
  current?: { temperature_2m?: number; weather_code?: number; wind_speed_10m?: number; is_day?: number };
  fallback?: { temperature_2m?: number; weather_code?: number; wind_speed_10m?: number; is_day?: number };
}

function pickIcon(code?: number, isDay?: number) {
  if (code == null) return Cloud;
  if (code === 0 || code === 1) return isDay === 0 ? Moon : Sun;
  if (code <= 3) return Cloud;
  if (code <= 49) return CloudFog;
  if (code <= 69) return CloudRain;
  if (code <= 79) return CloudSnow;
  if (code <= 99) return CloudLightning;
  return Cloud;
}

/** Hourly forecast chip for a specific point in time. */
export function WeatherAt({
  lat, lon, when, className = '',
}: {
  lat?: number | null;
  lon?: number | null;
  when?: string | Date | null;
  className?: string;
}) {
  const [data, setData] = useState<AtResponse | null>(null);
  const iso = when ? (when instanceof Date ? when.toISOString() : when) : null;

  useEffect(() => {
    if (lat == null || lon == null || !iso) return;
    let cancelled = false;
    api.get<AtResponse>('/weather/at', { params: { lat, lon, when: iso } })
      .then((r) => { if (!cancelled) setData(r.data); })
      .catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [lat, lon, iso]);

  if (lat == null || lon == null || !iso) return null;
  const t = data?.temperature_2m ?? data?.fallback?.temperature_2m;
  const code = data?.weather_code ?? data?.fallback?.weather_code;
  const isDay = data?.is_day ?? data?.fallback?.is_day;
  const Icon = pickIcon(code, isDay);
  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] text-slate-600 dark:text-slate-300 bg-slate-100/70 dark:bg-slate-800/60 ${className}`}
      title={`Forecast for ${new Date(iso).toLocaleString()}`}
    >
      <Icon className="w-3 h-3" />
      {t != null && <span className="font-semibold tabular-nums">{Math.round(t)}°</span>}
    </span>
  );
}

/** Current-conditions chip — refreshes every 15 minutes. */
export function WeatherNow({
  lat, lon, className = '',
}: {
  lat?: number | null;
  lon?: number | null;
  className?: string;
}) {
  const [data, setData] = useState<CurrentResponse | null>(null);

  useEffect(() => {
    if (lat == null || lon == null) return;
    let cancelled = false;
    function pull() {
      api.get<CurrentResponse>('/weather/current', { params: { lat, lon } })
        .then((r) => { if (!cancelled) setData(r.data); })
        .catch(() => { if (!cancelled) setData(null); });
    }
    pull();
    const i = setInterval(pull, 15 * 60_000);
    return () => { cancelled = true; clearInterval(i); };
  }, [lat, lon]);

  if (lat == null || lon == null) return null;
  const cur = data?.current ?? data?.fallback ?? {};
  const t = cur.temperature_2m;
  const code = cur.weather_code;
  const isDay = cur.is_day;
  const wind = cur.wind_speed_10m;
  const Icon = pickIcon(code, isDay);
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-xs ${className}`}
      title="Current weather at the venue"
    >
      <Icon className="w-3.5 h-3.5" />
      {t != null && <span className="font-semibold tabular-nums">{Math.round(t)}°</span>}
      {wind != null && <span className="text-[10px] text-slate-500">{Math.round(wind)} km/h</span>}
    </span>
  );
}
