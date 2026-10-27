import { useEffect, useState } from 'react';
import { Cloud, CloudRain, CloudSnow, Sun, CloudFog, CloudLightning, Moon } from 'lucide-react';
import { getWeather } from '../weather/weather';
import { forecastHour, WEATHER_REFRESH_MS } from '../weather/requestCache';
import { useLiteMode } from '../lite/LiteModeContext';
import { useLanguage } from '../i18n/LanguageContext';

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

function weatherIcon(className: string, code?: number, isDay?: number) {
  if (code == null) return <Cloud className={className} />;
  if (code === 0 || code === 1) return isDay === 0 ? <Moon className={className} /> : <Sun className={className} />;
  if (code <= 3) return <Cloud className={className} />;
  if (code <= 49) return <CloudFog className={className} />;
  if (code <= 69) return <CloudRain className={className} />;
  if (code <= 79) return <CloudSnow className={className} />;
  if (code <= 99) return <CloudLightning className={className} />;
  return <Cloud className={className} />;
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
  const { lite } = useLiteMode();
  const { t: tr, locale } = useLanguage();
  const iso = when ? forecastHour(when) : null;
  // Each answer is stored with the request it belongs to, so a change of venue or time
  // shows nothing until the new answer arrives, with no state reset inside the effect.
  const requestKey = `${lat}|${lon}|${iso}`;
  const [result, setResult] = useState<{ key: string; data: AtResponse | null } | null>(null);
  const data = result?.key === requestKey ? result.data : null;

  useEffect(() => {
    if (lite || lat == null || lon == null || !iso) return;
    let cancelled = false;
    getWeather<AtResponse>('/weather/at', { lat, lon, when: iso })
      .then((r) => { if (!cancelled) setResult({ key: requestKey, data: r }); })
      .catch(() => { if (!cancelled) setResult({ key: requestKey, data: null }); });
    return () => { cancelled = true; };
  }, [lat, lon, iso, requestKey, lite]);

  if (lite || lat == null || lon == null || !iso) return null;
  const t = data?.temperature_2m ?? data?.fallback?.temperature_2m;
  const code = data?.weather_code ?? data?.fallback?.weather_code;
  const isDay = data?.is_day ?? data?.fallback?.is_day;
  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] text-slate-600 dark:text-slate-300 bg-slate-100/70 dark:bg-slate-800/60 ${className}`}
      title={tr('teams.weather.forecastFor', { when: new Date(iso).toLocaleString(locale) })}
    >
      {weatherIcon('w-3 h-3', code, isDay)}
      {t != null && <span className="font-semibold tabular-nums">{Math.round(t)}°</span>}
    </span>
  );
}

/** Current-conditions chip — refreshes every 30 minutes. */
export function WeatherNow({
  lat, lon, className = '',
}: {
  lat?: number | null;
  lon?: number | null;
  className?: string;
}) {
  const { lite } = useLiteMode();
  const { t: tr } = useLanguage();
  const requestKey = `${lat}|${lon}`;
  const [result, setResult] = useState<{ key: string; data: CurrentResponse | null } | null>(null);
  const data = result?.key === requestKey ? result.data : null;

  useEffect(() => {
    if (lite || lat == null || lon == null) return;
    let cancelled = false;
    function pull() {
      if (!navigator.onLine || document.visibilityState !== 'visible') return;
      getWeather<CurrentResponse>('/weather/current', { lat: lat!, lon: lon! })
        .then((r) => { if (!cancelled) setResult({ key: requestKey, data: r }); })
        .catch(() => { if (!cancelled) setResult({ key: requestKey, data: null }); });
    }
    pull();
    const i = setInterval(pull, WEATHER_REFRESH_MS);
    return () => { cancelled = true; clearInterval(i); };
  }, [lat, lon, requestKey, lite]);

  if (lite || lat == null || lon == null) return null;
  const cur = data?.current ?? data?.fallback ?? {};
  const t = cur.temperature_2m;
  const code = cur.weather_code;
  const isDay = cur.is_day;
  const wind = cur.wind_speed_10m;
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-xs ${className}`}
      title={tr('teams.weather.currentAtVenue')}
    >
      {weatherIcon('w-3.5 h-3.5', code, isDay)}
      {t != null && <span className="font-semibold tabular-nums">{Math.round(t)}°</span>}
      {wind != null && <span className="text-[10px] text-slate-500">{Math.round(wind)} km/h</span>}
    </span>
  );
}
