import { useEffect, useState } from 'react';
import { Cloud, CloudRain, CloudSnow, Sun, CloudFog, CloudLightning } from 'lucide-react';
import { api } from '../api';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';

interface AtData {
  hour?: string;
  temperature_2m?: number;
  weather_code?: number;
  is_day?: number;
  fallback?: { temperature_2m?: number; weather_code?: number; is_day?: number };
}

interface SessionLite {
  status: number;
  scheduledStart?: string | null;
  startedAt?: string | null;
  isBreak: boolean;
  kind?: number;
  name: string;
}

interface CompetitionLite {
  latitude?: number | null;
  longitude?: number | null;
  sessions: SessionLite[];
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

function activeSessionTime(comp: CompetitionLite | null): Date | null {
  if (!comp) return null;
  const inArena = comp.sessions.find((s) => s.status === 1 && (s.kind ?? (s.isBreak ? 1 : 0)) === 0);
  if (inArena) return new Date(inArena.startedAt ?? inArena.scheduledStart ?? Date.now());
  const upcoming = comp.sessions
    .filter((s) => s.status === 0 && (s.kind ?? (s.isBreak ? 1 : 0)) === 0 && s.scheduledStart)
    .sort((a, b) => new Date(a.scheduledStart!).getTime() - new Date(b.scheduledStart!).getTime())[0];
  if (upcoming?.scheduledStart) return new Date(upcoming.scheduledStart);
  return null;
}

export function WeatherBadge({ lat: latProp, lon: lonProp }: { lat?: number; lon?: number } = {}) {
  const [data, setData] = useState<AtData | null>(null);
  const [comp, setComp] = useState<CompetitionLite | null>(null);
  const { current } = useCurrentCompetition();

  useEffect(() => {
    if (current == null) { setComp(null); return; }
    api.get<CompetitionLite>(`/competitions/${current.id}`)
      .then((r) => setComp(r.data))
      .catch(() => setComp(null));
  }, [current?.id]);

  const targetTime = activeSessionTime(comp) ?? new Date();
  const lat = latProp ?? comp?.latitude ?? 52.2569;
  const lon = lonProp ?? comp?.longitude ?? -1.5398;

  useEffect(() => {
    let cancelled = false;
    api.get<AtData>('/weather/at', { params: { lat, lon, when: targetTime.toISOString() } })
      .then((r) => { if (!cancelled) setData(r.data); })
      .catch(() => { if (!cancelled) setData({ fallback: { temperature_2m: 15, weather_code: 3 } }); });
    return () => { cancelled = true; };
  }, [lat, lon, targetTime.toISOString().slice(0, 13)]);

  const temp = data?.temperature_2m ?? data?.fallback?.temperature_2m;
  const code = data?.weather_code ?? data?.fallback?.weather_code;
  const Icon = pickIcon(code);
  const hourLabel = targetTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div
      className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl bg-white/60 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700"
      title={`Forecast for ${hourLabel}`}
    >
      <Icon className="w-5 h-5 text-brand-700 dark:text-brand-300" />
      <div className="leading-tight">
        <div className="text-sm font-medium">
          {temp != null ? `${Math.round(temp)}°C` : '—'}
        </div>
        <div className="text-[9px] text-slate-500 dark:text-slate-400">@ {hourLabel}</div>
      </div>
    </div>
  );
}
