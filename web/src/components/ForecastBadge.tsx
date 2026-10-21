import { useEffect, useState } from 'react';
import { Cloud, CloudRain, CloudSnow, Sun, CloudFog, CloudLightning } from 'lucide-react';
import { getWeather } from '../weather/weather';

interface ForecastData {
  daily?: {
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
  };
  fallback?: {
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
  };
}

function weatherIcon(className: string, code?: number) {
  if (code == null) return <Cloud className={className} />;
  if (code === 0) return <Sun className={className} />;
  if (code <= 3) return <Cloud className={className} />;
  if (code <= 49) return <CloudFog className={className} />;
  if (code <= 69) return <CloudRain className={className} />;
  if (code <= 79) return <CloudSnow className={className} />;
  if (code <= 99) return <CloudLightning className={className} />;
  return <Cloud className={className} />;
}

interface Props {
  lat?: number | null;
  lon?: number | null;
  date?: string | null;
  className?: string;
}

export function ForecastBadge({ lat, lon, date, className = '' }: Props) {
  // The forecast is stored with the request it answers, so a change of venue or date
  // shows nothing until the new answer arrives, with no state reset inside the effect.
  const requestKey = `${lat}|${lon}|${date}`;
  const [result, setResult] = useState<{ key: string; data: ForecastData | null } | null>(null);
  const data = result?.key === requestKey ? result.data : null;

  useEffect(() => {
    if (lat == null || lon == null || !date) return;
    let cancelled = false;
    const day = new Date(date).toISOString().slice(0, 10);
    getWeather<ForecastData>('/weather/forecast', { lat, lon, date: day })
      .then((r) => { if (!cancelled) setResult({ key: requestKey, data: r }); })
      .catch(() => { if (!cancelled) setResult({ key: requestKey, data: null }); });
    return () => { cancelled = true; };
  }, [lat, lon, date, requestKey]);

  if (lat == null || lon == null || !date) return null;

  const daily = data?.daily ?? data?.fallback;
  const code = daily?.weather_code?.[0];
  const max = daily?.temperature_2m_max?.[0];
  const min = daily?.temperature_2m_min?.[0];

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100/80 dark:bg-slate-800/70 text-[10px] text-slate-700 dark:text-slate-200 ${className}`}
      title={`Forecast for ${new Date(date).toLocaleDateString()}`}
    >
      {weatherIcon('w-3 h-3', code)}
      {max != null && min != null ? (
        <span><span className="font-semibold">{Math.round(max)}°</span> / {Math.round(min)}°</span>
      ) : (
        <span>—</span>
      )}
    </span>
  );
}
