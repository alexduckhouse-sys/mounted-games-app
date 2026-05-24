import { useEffect, useState } from 'react';
import { Cloud, CloudRain, CloudSnow, Sun, CloudFog, CloudLightning } from 'lucide-react';
import { api } from '../api';

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

interface Props {
  lat?: number | null;
  lon?: number | null;
  date?: string | null;
  className?: string;
}

export function ForecastBadge({ lat, lon, date, className = '' }: Props) {
  const [data, setData] = useState<ForecastData | null>(null);

  useEffect(() => {
    if (lat == null || lon == null || !date) return;
    let cancelled = false;
    const day = new Date(date).toISOString().slice(0, 10);
    api.get<ForecastData>('/weather/forecast', { params: { lat, lon, date: day } })
      .then((r) => { if (!cancelled) setData(r.data); })
      .catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [lat, lon, date]);

  if (lat == null || lon == null || !date) return null;

  const daily = data?.daily ?? data?.fallback;
  const code = daily?.weather_code?.[0];
  const max = daily?.temperature_2m_max?.[0];
  const min = daily?.temperature_2m_min?.[0];
  const Icon = pickIcon(code);

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100/80 dark:bg-slate-800/70 text-[10px] text-slate-700 dark:text-slate-200 ${className}`}
      title={`Forecast for ${new Date(date).toLocaleDateString()}`}
    >
      <Icon className="w-3 h-3" />
      {max != null && min != null ? (
        <span><span className="font-semibold">{Math.round(max)}°</span> / {Math.round(min)}°</span>
      ) : (
        <span>—</span>
      )}
    </span>
  );
}
