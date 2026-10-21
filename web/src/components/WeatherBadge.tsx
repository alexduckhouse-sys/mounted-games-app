import { useEffect, useState } from 'react';
import { Cloud, CloudRain, CloudSnow, Sun, CloudFog, CloudLightning } from 'lucide-react';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { getWeather } from '../weather/weather';
import { WEATHER_REFRESH_MS } from '../weather/requestCache';
import { useLiteMode } from '../lite/LiteModeContext';

interface CurrentWeather { current?: { temperature_2m?: number; weather_code?: number } }

function weatherIcon(className: string, code?: number) {
  if (code == null) return <Cloud className={className} aria-hidden="true" />;
  if (code === 0) return <Sun className={className} aria-hidden="true" />;
  if (code <= 3) return <Cloud className={className} aria-hidden="true" />;
  if (code <= 49) return <CloudFog className={className} aria-hidden="true" />;
  if (code <= 69) return <CloudRain className={className} aria-hidden="true" />;
  if (code <= 79) return <CloudSnow className={className} aria-hidden="true" />;
  if (code <= 99) return <CloudLightning className={className} aria-hidden="true" />;
  return <Cloud className={className} aria-hidden="true" />;
}

export function WeatherBadge({ lat: latProp, lon: lonProp }: { lat?: number; lon?: number } = {}) {
  const { venue } = useCurrentCompetition();
  const { lite } = useLiteMode();
  const lat = latProp ?? venue?.lat;
  const lon = lonProp ?? venue?.lon;
  // The reading is stored with the venue it belongs to, so moving to another venue
  // shows nothing until that venue's reading arrives.
  const venueKey = `${lat}|${lon}`;
  const [result, setResult] = useState<{ key: string; data: CurrentWeather | null } | null>(null);
  const data = result?.key === venueKey ? result.data : null;

  useEffect(() => {
    if (lite) return;
    let cancelled = false;
    function refresh() {
      if (lat == null || lon == null || !navigator.onLine || document.visibilityState !== 'visible') return;
      getWeather<CurrentWeather>('/weather/current', { lat, lon })
        .then((weather) => { if (!cancelled) setResult({ key: venueKey, data: weather }); })
        .catch(() => { if (!cancelled) setResult({ key: venueKey, data: null }); });
    }
    refresh();
    const timer = setInterval(refresh, WEATHER_REFRESH_MS);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [lat, lon, venueKey, lite]);

  if (lite) return null;
  const temperature = data?.current?.temperature_2m;
  return <div className="flex min-h-11 items-center gap-1.5 px-2 py-1 rounded-xl bg-white/60 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700" title={temperature == null ? 'Venue weather unavailable' : 'Venue weather · updated every 30 minutes'}>
    {weatherIcon('w-5 h-5 text-brand-700 dark:text-brand-300', data?.current?.weather_code)}
    <div className="leading-tight"><div className="text-sm font-medium">{temperature == null ? '—' : `${Math.round(temperature)}°C`}</div><div className="text-[9px] text-slate-500 dark:text-slate-400">Weather</div></div>
  </div>;
}
