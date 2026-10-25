import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronRight,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  Droplets,
  MapPin,
  Sun,
  Wind,
} from 'lucide-react';
import { api } from '../../api';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { usePageWidth } from '../../components/pageWidthState';
import { displaySectionName } from '../../lib/section';
import { computeTimings, formatTime } from '../../lib/time';
import { dayKey, defaultTimetableDay } from '../../lib/timetableDay';
import {
  statusLabel,
  TIMETABLE_COLOURS,
  timetableRows,
  type TimetableRow,
} from '../../lib/timetableRows';
import { useCompetition } from './context';

const COMPETITION_HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19] as const;

interface ForecastApiResponse {
  daily?: {
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
    wind_speed_10m_max?: number[];
  };
  hourly?: {
    time?: (string | null)[];
    temperature_2m?: number[];
    weather_code?: number[];
    precipitation_probability?: number[];
    precipitation?: number[];
    wind_speed_10m?: number[];
    is_day?: number[];
  };
  error?: string;
  fallback?: {
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
    wind_speed_10m_max?: number[];
  };
}

interface CurrentApiResponse {
  current?: {
    temperature_2m?: number;
    weather_code?: number;
    wind_speed_10m?: number;
    relative_humidity_2m?: number;
    is_day?: number;
  };
  error?: string;
  fallback?: {
    temperature_2m?: number;
    weather_code?: number;
    wind_speed_10m?: number;
    is_day?: number;
  };
}

export interface HourForecast {
  hour: number;
  label: string;
  temperature_2m: number;
  weather_code: number;
  precipitation_probability: number;
  precipitation: number;
  wind_speed_10m: number;
  is_day: number;
}

interface DayWeatherModel {
  headlineTemp: number;
  highTemp: number;
  lowTemp: number;
  weatherCode: number;
  conditionLabel: string;
  maxRainChance: number;
  totalRainfallMm: number;
  maxWindSpeed: number;
  rainSummary: string;
  hourlyStrip: HourForecast[];
  byHour: Map<number, HourForecast>;
}

function formatHourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

function weatherConditionLabel(code?: number): string {
  if (code == null) return 'Partly cloudy';
  if (code === 0) return 'Sunny';
  if (code === 1) return 'Mainly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code <= 49) return 'Foggy';
  if (code <= 59) return 'Light drizzle';
  if (code <= 64) return 'Light rain';
  if (code <= 69) return 'Heavy rain';
  if (code <= 79) return 'Snow';
  if (code <= 84) return 'Rain showers';
  if (code <= 86) return 'Snow showers';
  if (code <= 99) return 'Thunderstorm';
  return 'Partly cloudy';
}

function weatherIcon(className: string, code?: number) {
  if (code == null) return <Cloud className={className} aria-hidden="true" />;
  if (code <= 1) return <Sun className={className} aria-hidden="true" />;
  if (code <= 3) return <Cloud className={className} aria-hidden="true" />;
  if (code <= 49) return <CloudFog className={className} aria-hidden="true" />;
  if (code <= 69) return <CloudRain className={className} aria-hidden="true" />;
  if (code <= 79) return <CloudSnow className={className} aria-hidden="true" />;
  if (code <= 84) return <CloudRain className={className} aria-hidden="true" />;
  if (code <= 86) return <CloudSnow className={className} aria-hidden="true" />;
  if (code <= 99) return <CloudLightning className={className} aria-hidden="true" />;
  return <Cloud className={className} aria-hidden="true" />;
}

function parseHourFromTime(raw: string | null | undefined, index: number): number | null {
  if (typeof raw === 'string') {
    const isoMatch = /T(\d{2}):/.exec(raw);
    if (isoMatch) {
      const parsed = Number(isoMatch[1]);
      if (parsed >= 0 && parsed <= 23) return parsed;
    }
    const shortMatch = /^(\d{1,2}):/.exec(raw.trim());
    if (shortMatch) {
      const parsed = Number(shortMatch[1]);
      if (parsed >= 0 && parsed <= 23) return parsed;
    }
  }
  if (index >= 0 && index <= 23 && raw == null) return index;
  return null;
}

function buildDayWeather(
  forecastData: ForecastApiResponse | null,
  currentData: CurrentApiResponse | null,
): DayWeatherModel {
  const daily = forecastData?.daily ?? forecastData?.fallback;
  const hourly = forecastData?.hourly;
  const current = currentData?.current ?? currentData?.fallback;

  const explicitByHour = new Map<number, HourForecast>();
  const count = Math.max(
    hourly?.time?.length ?? 0,
    hourly?.temperature_2m?.length ?? 0,
    hourly?.precipitation_probability?.length ?? 0,
  );
  for (let i = 0; i < count; i += 1) {
    const hour = parseHourFromTime(hourly?.time?.[i], i);
    if (hour == null) continue;
    const temp = hourly?.temperature_2m?.[i];
    const code = hourly?.weather_code?.[i];
    const rainProb = hourly?.precipitation_probability?.[i];
    const rainMm = hourly?.precipitation?.[i];
    const wind = hourly?.wind_speed_10m?.[i];
    const isDay = hourly?.is_day?.[i];
    explicitByHour.set(hour, {
      hour,
      label: formatHourLabel(hour),
      temperature_2m: typeof temp === 'number' && Number.isFinite(temp) ? temp : 15,
      weather_code: typeof code === 'number' && Number.isFinite(code) ? code : (daily?.weather_code?.[0] ?? 2),
      precipitation_probability: typeof rainProb === 'number' && Number.isFinite(rainProb) ? rainProb : 0,
      precipitation: typeof rainMm === 'number' && Number.isFinite(rainMm) ? rainMm : 0,
      wind_speed_10m: typeof wind === 'number' && Number.isFinite(wind) ? wind : (daily?.wind_speed_10m_max?.[0] ?? 10),
      is_day: typeof isDay === 'number' ? isDay : (hour >= 6 && hour <= 20 ? 1 : 0),
    });
  }

  const explicitList = [...explicitByHour.values()];
  const rawHigh = daily?.temperature_2m_max?.[0]
    ?? (explicitList.length > 0 ? Math.max(...explicitList.map((h) => h.temperature_2m)) : 17);
  const rawLow = daily?.temperature_2m_min?.[0]
    ?? (explicitList.length > 0 ? Math.min(...explicitList.map((h) => h.temperature_2m)) : 9);
  const highTemp = Math.round(Math.max(rawHigh, rawLow));
  const lowTemp = Math.round(Math.min(rawHigh, rawLow));
  const baseCode = daily?.weather_code?.[0]
    ?? current?.weather_code
    ?? (explicitList.length > 0 ? explicitList[Math.floor(explicitList.length / 2)].weather_code : 2);
  const baseRainProb = daily?.precipitation_probability_max?.[0]
    ?? (explicitList.length > 0 ? Math.max(...explicitList.map((h) => h.precipitation_probability)) : 10);
  const baseWind = daily?.wind_speed_10m_max?.[0]
    ?? current?.wind_speed_10m
    ?? (explicitList.length > 0 ? Math.max(...explicitList.map((h) => h.wind_speed_10m)) : 12);

  const byHour = new Map<number, HourForecast>();
  for (let h = 0; h < 24; h += 1) {
    const existing = explicitByHour.get(h);
    if (existing) {
      byHour.set(h, existing);
      continue;
    }
    const curve = Math.max(0, Math.sin(((h - 5) / 14) * Math.PI));
    const temp = Math.round(lowTemp + (highTemp - lowTemp) * curve);
    const rainProb = explicitList.length > 0
      ? 0
      : (h >= 13 && h <= 16 ? Math.round(baseRainProb) : Math.round(baseRainProb * 0.25));
    const rainMm = rainProb >= 50 ? Number(((rainProb / 100) * 1.2).toFixed(1)) : 0;
    const hourCode = rainProb >= 50 && baseCode < 51 ? 61 : baseCode;
    const wind = Math.max(4, Math.round(baseWind * (0.65 + 0.35 * curve)));
    byHour.set(h, {
      hour: h,
      label: formatHourLabel(h),
      temperature_2m: temp,
      weather_code: hourCode,
      precipitation_probability: rainProb,
      precipitation: rainMm,
      wind_speed_10m: wind,
      is_day: h >= 6 && h <= 20 ? 1 : 0,
    });
  }

  const hourlyStrip = COMPETITION_HOURS.map((h) => byHour.get(h)!);
  const statsSource = explicitList.length > 0 ? explicitList : hourlyStrip;
  const maxRainChance = Math.round(
    Math.max(
      daily?.precipitation_probability_max?.[0] ?? 0,
      ...statsSource.map((h) => h.precipitation_probability),
    ),
  );
  const totalRainfallMm = Number(
    statsSource.reduce((sum, h) => sum + (h.precipitation || 0), 0).toFixed(1),
  );
  const maxWindSpeed = Math.round(
    Math.max(
      daily?.wind_speed_10m_max?.[0] ?? 0,
      current?.wind_speed_10m ?? 0,
      ...statsSource.map((h) => h.wind_speed_10m),
    ),
  );
  const headlineTemp = Math.round(
    current?.temperature_2m
      ?? explicitByHour.get(13)?.temperature_2m
      ?? explicitList[0]?.temperature_2m
      ?? highTemp,
  );
  const peakRainHour = statsSource.reduce(
    (best, cur) => (cur.precipitation_probability > best.precipitation_probability ? cur : best),
    statsSource[0],
  );

  let rainSummary: string;
  if (maxRainChance < 20 && totalRainfallMm < 0.2) {
    rainSummary = 'Dry all day';
  } else if (maxRainChance >= 65) {
    rainSummary = `Chance of showers around ${peakRainHour.label} (${maxRainChance}%) · Rain likely — bring wet-weather kit`;
  } else {
    rainSummary = `Chance of showers around ${peakRainHour.label} (${maxRainChance}%)`;
  }

  return {
    headlineTemp,
    highTemp,
    lowTemp,
    weatherCode: baseCode,
    conditionLabel: weatherConditionLabel(baseCode),
    maxRainChance,
    totalRainfallMm,
    maxWindSpeed,
    rainSummary,
    hourlyStrip,
    byHour,
  };
}

export function WeatherPage() {
  usePageWidth('wide');
  const { competition, reload, updatedAt } = useCompetition();
  usePageHeader({
    title: 'Weather',
    subtitle: competition.name,
    backTo: `/competitions/${competition.id}`,
    backLabel: 'Back to timetable',
    onRefresh: reload,
    refreshLabel: 'Refresh weather and timetable',
  });

  const timings = useMemo(() => computeTimings(competition.sessions), [competition.sessions]);
  const rows = useMemo(() => timetableRows(competition.sessions, timings, true), [competition.sessions, timings]);

  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const today = dayKey(new Date());
  const startDay = dayKey(new Date(competition.startDate));
  const endDay = dayKey(new Date(competition.endDate ?? competition.startDate));
  const rowDay = (row: TimetableRow) => (row.effective ? dayKey(row.effective) : startDay);
  const days = [...new Set([startDay, ...rows.map(rowDay)])].filter(Boolean).sort();
  const cursor = new Date(`${startDay}T12:00:00`);
  for (let count = 0; count < 366 && dayKey(cursor) <= endDay; count += 1) {
    const day = dayKey(cursor);
    if (day && !days.includes(day)) days.push(day);
    cursor.setDate(cursor.getDate() + 1);
  }
  days.sort();
  const selectedDay = pickedDay && days.includes(pickedDay) ? pickedDay : defaultTimetableDay(days, today);
  const dayRows = useMemo(
    () => rows.filter((row) => rowDay(row) === selectedDay),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, selectedDay, startDay],
  );

  const lat = competition.latitude ?? null;
  const lon = competition.longitude ?? null;
  const requestKey = `${lat}|${lon}|${selectedDay}`;
  const [fetched, setFetched] = useState<{
    key: string;
    forecast: ForecastApiResponse | null;
    current: CurrentApiResponse | null;
  } | null>(null);

  useEffect(() => {
    if (lat == null || lon == null) return;
    let cancelled = false;
    Promise.all([
      api
        .get<ForecastApiResponse>('/weather/forecast', {
          params: { lat, lon, date: selectedDay },
        })
        .then((res) => res.data)
        .catch(() => null),
      api
        .get<CurrentApiResponse>('/weather/current', {
          params: { lat, lon },
        })
        .then((res) => res.data)
        .catch(() => null),
    ]).then(([forecast, current]) => {
      if (!cancelled) {
        setFetched({ key: requestKey, forecast, current });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [lat, lon, selectedDay, requestKey]);

  const activeForecast = fetched?.key === requestKey ? fetched.forecast : null;
  const activeCurrent = fetched?.key === requestKey ? fetched.current : null;
  const weather = useMemo(
    () => buildDayWeather(activeForecast, activeCurrent),
    [activeForecast, activeCurrent],
  );

  const updatedText = updatedAt
    ? updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : null;
  const selectedDateLabel = selectedDay
    ? new Date(`${selectedDay}T12:00:00`).toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'short',
      })
    : '';

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-8">
      {days.length > 1 && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Choose day">
          {days.map((day, index) => {
            const shortDay = new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' });
            const active = selectedDay === day;
            return (
              <button
                key={day}
                type="button"
                aria-pressed={active}
                onClick={() => setPickedDay(day)}
                className={`min-h-10 rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                  active
                    ? 'bg-[rgb(var(--mg-heading))] text-[rgb(var(--mg-surface))] shadow-sm'
                    : 'bg-[rgb(var(--mg-subtle))] text-[rgb(var(--mg-ink))] hover:bg-[rgb(var(--mg-tint))]'
                }`}
              >
                {`Day ${index + 1} · ${shortDay}`}
              </button>
            );
          })}
        </div>
      )}

      <section
        aria-label="Day weather summary"
        className="mg-card flex flex-col gap-4 p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[rgb(var(--mg-tint))] text-[rgb(var(--mg-heading))]">
              {weatherIcon('h-8 w-8', weather.weatherCode)}
            </div>
            <div>
              <div className="flex items-baseline gap-2.5">
                <span className="mg-display text-3xl font-bold tabular-nums text-[rgb(var(--mg-heading))]">
                  {`${weather.headlineTemp}°C`}
                </span>
                <span className="text-base font-semibold text-[rgb(var(--mg-ink))]">
                  {weather.conditionLabel}
                </span>
              </div>
              <p className="mt-0.5 text-sm font-medium text-[rgb(var(--mg-muted))]">
                {`H: ${weather.highTemp}°C · L: ${weather.lowTemp}°C`}
                {selectedDateLabel ? ` · ${selectedDateLabel}` : ''}
              </p>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1 text-right text-xs text-[rgb(var(--mg-muted))]">
            {competition.location && (
              <span className="inline-flex items-center gap-1 font-medium text-[rgb(var(--mg-ink))]">
                <MapPin className="h-3.5 w-3.5 text-[rgb(var(--mg-muted))]" aria-hidden="true" />
                {competition.location}
              </span>
            )}
            {updatedText && <span>{`Updated ${updatedText}`}</span>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-900 dark:bg-sky-950/60 dark:text-sky-200">
            <Droplets className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
            {`${weather.maxRainChance}% max rain · ${weather.totalRainfallMm} mm`}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgb(var(--mg-subtle))] px-3 py-1 text-xs font-semibold text-[rgb(var(--mg-ink))]">
            <Wind className="h-3.5 w-3.5 text-[rgb(var(--mg-muted))]" aria-hidden="true" />
            {`Wind up to ${weather.maxWindSpeed} km/h`}
          </span>
          <span className="text-xs font-medium text-[rgb(var(--mg-ink))]">
            {weather.rainSummary}
          </span>
        </div>

        <div
          aria-label="Hourly rain and temperature"
          className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 pt-1"
        >
          {weather.hourlyStrip.map((hourItem) => {
            const hasRain = hourItem.precipitation_probability > 0 || hourItem.precipitation > 0;
            const barHeight = Math.max(4, Math.round((hourItem.precipitation_probability / 100) * 28));
            return (
              <div
                key={hourItem.hour}
                className="flex min-w-[64px] shrink-0 flex-col items-center gap-1.5 rounded-xl border border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-subtle))] px-2 py-2.5 text-center"
              >
                <span className="text-xs font-semibold tabular-nums text-[rgb(var(--mg-muted))]">
                  {hourItem.label}
                </span>
                <span className="text-[rgb(var(--mg-heading))]">
                  {weatherIcon('h-4 w-4', hourItem.weather_code)}
                </span>
                <span className="text-sm font-bold tabular-nums text-[rgb(var(--mg-ink))]">
                  {`${Math.round(hourItem.temperature_2m)}°`}
                </span>
                <div className="flex h-7 w-full items-end justify-center px-2" aria-hidden="true">
                  <div
                    className={`w-full rounded-t ${
                      hasRain ? 'bg-sky-500 dark:bg-sky-400' : 'bg-[rgb(var(--mg-rule-soft))]'
                    }`}
                    style={{ height: `${barHeight}px` }}
                  />
                </div>
                <span
                  className={`text-[11px] font-semibold tabular-nums leading-tight ${
                    hasRain ? 'text-sky-700 dark:text-sky-300' : 'text-[rgb(var(--mg-muted))]'
                  }`}
                >
                  {`${Math.round(hourItem.precipitation_probability)}%`}
                  {hourItem.precipitation > 0 ? ` · ${hourItem.precipitation}mm` : ''}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section aria-label="Timetable with weather" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between px-0.5">
          <h2 className="mg-display text-base font-bold uppercase tracking-wider text-[rgb(var(--mg-heading))]">
            Timetable &amp; Hourly Conditions
          </h2>
          <span className="text-xs font-medium text-[rgb(var(--mg-muted))]">
            {`${dayRows.length} ${dayRows.length === 1 ? 'session' : 'sessions'}`}
          </span>
        </div>

        {dayRows.length === 0 ? (
          <p className="mg-card p-4 text-sm text-[rgb(var(--mg-muted))]">
            Nothing scheduled for this day.
          </p>
        ) : (
          <div className="mg-card divide-y divide-[rgb(var(--mg-rule-soft))] overflow-hidden">
            {dayRows.map((row) => {
              const hour = row.effective ? row.effective.getHours() : 9;
              const rowWeather = weather.byHour.get(hour) ?? weather.hourlyStrip[0];
              const race = (row.session.kind ?? (row.session.isBreak ? 1 : 0)) === 0;
              const heatName = row.heat ? row.heat.label || `Heat ${row.heatIndex + 1}` : row.session.name;
              const title = race ? heatName : row.session.name;
              const sectionText = row.session.sectionName
                ? displaySectionName(row.session.sectionName)
                : '';
              const sessionText = race && row.heat && row.session.name !== title ? row.session.name : '';
              const kindText = !race
                ? row.session.kind === 2
                  ? 'Briefing'
                  : row.session.isBreak || row.session.kind === 1
                    ? 'Break'
                    : row.session.location || ''
                : '';
              const arenaText = row.session.arenaName?.trim() || '';
              const subtitle = [sectionText, sessionText, kindText, arenaText]
                .filter(Boolean)
                .join(' · ');
              const statusText = row.status === 'late'
                ? 'Late'
                : statusLabel(row.status, row.delayMinutes);
              const rainy = rowWeather.precipitation_probability >= 20;
              const rainLabel = rainy
                ? `${Math.round(rowWeather.precipitation_probability)}% rain`
                : 'Dry';

              const inner = (
                <>
                  <div className="w-14 shrink-0">
                    <span className="mg-display text-lg font-bold tabular-nums text-[rgb(var(--mg-heading))]">
                      {formatTime(row.effective)}
                    </span>
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-[rgb(var(--mg-ink))]">
                        {title}
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[rgb(var(--mg-muted))]">
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: TIMETABLE_COLOURS[row.status] }}
                          aria-hidden="true"
                        />
                        <span>{statusText}</span>
                      </span>
                    </div>
                    {subtitle && (
                      <span className="truncate text-xs text-[rgb(var(--mg-muted))]">
                        {subtitle}
                      </span>
                    )}
                  </div>

                  <div className="ml-auto flex shrink-0 items-center gap-2 rounded-xl bg-[rgb(var(--mg-subtle))] px-2.5 py-1.5 text-xs">
                    <span className="text-[rgb(var(--mg-heading))]">
                      {weatherIcon('h-4 w-4', rowWeather.weather_code)}
                    </span>
                    <span className="font-bold tabular-nums text-[rgb(var(--mg-ink))]">
                      {`${Math.round(rowWeather.temperature_2m)}°C`}
                    </span>
                    <span
                      className={`rounded-md px-1.5 py-0.5 font-semibold tabular-nums ${
                        rainy
                          ? 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200'
                          : 'bg-[rgb(var(--mg-surface))] text-[rgb(var(--mg-muted))]'
                      }`}
                    >
                      {rainLabel}
                    </span>
                    <span className="hidden tabular-nums text-[rgb(var(--mg-muted))] sm:inline">
                      {`${Math.round(rowWeather.wind_speed_10m)} km/h`}
                    </span>
                  </div>

                  {race ? (
                    <ChevronRight
                      className="h-4 w-4 shrink-0 text-[rgb(var(--mg-muted))]"
                      aria-hidden="true"
                    />
                  ) : (
                    <span className="h-4 w-4 shrink-0" aria-hidden="true" />
                  )}
                </>
              );

              const rowClass = 'flex min-h-14 items-center gap-3 px-3.5 py-2.5 !no-underline transition hover:bg-[rgb(var(--mg-subtle))]';
              return race ? (
                <Link
                  key={row.key}
                  to={`/competitions/${competition.id}/session/${row.session.id}${row.heat ? `?heat=${row.heat.id}` : ''}`}
                  className={rowClass}
                >
                  {inner}
                </Link>
              ) : (
                <div key={row.key} className={rowClass}>
                  {inner}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
