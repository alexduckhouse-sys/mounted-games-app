import { useEffect, useState } from 'react';
import { Cloud, CloudRain, CloudSnow, Sun, CloudFog, CloudLightning } from 'lucide-react';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { getWeather } from '../weather/weather';
import { WEATHER_REFRESH_MS } from '../weather/requestCache';

interface CurrentWeather { current?: { temperature_2m?: number; weather_code?: number } }

function pickIcon(code?: number) {
  if (code == null) return Cloud;
  if (code === 0) return Sun;
  if (code <= 3) return Cloud;
  if (code <= 49) return CloudFog;
  if (code <= 69) return CloudRain;
  if (code <= 79) return CloudSnow;
  if (code <= 99) return CloudLightning;
  return Cloud;
}

export function WeatherBadge({ lat: latProp, lon: lonProp }: { lat?: number; lon?: number } = {}) {
  const { venue } = useCurrentCompetition();
  const lat = latProp ?? venue?.lat;
  const lon = lonProp ?? venue?.lon;
  const [data, setData] = useState<CurrentWeather | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    function refresh() {
      if (lat == null || lon == null || !navigator.onLine || document.visibilityState !== 'visible') return;
      getWeather<CurrentWeather>('/weather/current', { lat, lon })
        .then((weather) => { if (!cancelled) setData(weather); })
        .catch(() => { if (!cancelled) setData(null); });
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
  }, [lat, lon]);

  const temperature = data?.current?.temperature_2m;
  const Icon = pickIcon(data?.current?.weather_code);
  return <div className="flex min-h-11 items-center gap-1.5 px-2 py-1 rounded-xl bg-white/60 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700" title={temperature == null ? 'Venue weather unavailable' : 'Venue weather · updated every 30 minutes'}>
    <Icon className="w-5 h-5 text-brand-700 dark:text-brand-300" aria-hidden="true" />
    <div className="leading-tight"><div className="text-sm font-medium">{temperature == null ? '—' : `${Math.round(temperature)}°C`}</div><div className="text-[9px] text-slate-500 dark:text-slate-400">Weather</div></div>
  </div>;
}
