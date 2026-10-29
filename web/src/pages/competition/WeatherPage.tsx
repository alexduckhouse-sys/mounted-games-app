import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { api } from '../../api';
import { venueDay } from '../../lib/windForecast';
import { parseForecastHours } from '../../lib/weatherAlert';
import { WindReviewSheet } from '../../components/WindReviewSheet';
import { Notice } from '../../components/Notice';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { usePageWidth } from '../../components/pageWidthState';
import { WeatherIcon } from '../../components/WeatherIcon';
import '../../components/sitePages.css';
import '../../components/eventPages.css';
import { displaySectionName } from '../../lib/section';
import { computeTimings, formatTime } from '../../lib/time';
import { dayKey, defaultTimetableDay } from '../../lib/timetableDay';
import { timetableRows, type TimetableRow } from '../../lib/timetableRows';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { hazardOf } from '../../lib/weatherAlert';
import { useLanguage } from '../../i18n/LanguageContext';
import { activeLocale } from '../../i18n/translate';
import { weatherConditionKey } from '../../lib/weatherText';

interface ForecastApiResponse {
  utc_offset_seconds?: number;
  fetchedAt?: string;
  timezone?: string;
  gustIntervals?: { startsAt: number; endsAt: number; gustMph: number }[];
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
    wind_speed_10m_max?: number[];
  };
  hourly?: {
    time?: (string | number | null)[];
    temperature_2m?: number[];
    weather_code?: number[];
    precipitation_probability?: number[];
    precipitation?: number[];
    wind_speed_10m?: number[];
    is_day?: number[];
  };
  error?: string;

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

}

export interface HourForecast {
  startsAt: number;
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
  headlineTemp: number | null;
  weatherCode: number | undefined;
  maxRainChance: number | null;
  maxWindSpeed: number | null;
  hours: HourForecast[];
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function eventCalendarDay(value: string): string {
  // Event dates identify calendar days, even when the API serialises them at UTC midnight.
  return /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0] ?? dayKey(new Date(value));
}

function buildDayWeather(
  forecastData: ForecastApiResponse | null,
  currentData: CurrentApiResponse | null,
  selectedDay: string,
): DayWeatherModel | null {
  // The API's error fallback contains placeholders, not a weather observation.
  if (!forecastData || forecastData.error) return null;
  const offset = forecastData.utc_offset_seconds;
  const dayStart = new Date(`${selectedDay}T00:00:00`);
  const dayEnd = new Date(`${selectedDay}T23:59:59`);
  // A venue's daily totals describe this device's day only when the boundaries agree.
  const sameDayBounds = finite(offset) && offset === -dayStart.getTimezoneOffset() * 60
    && offset === -dayEnd.getTimezoneOffset() * 60;
  const daily = sameDayBounds && (!forecastData.daily?.time?.[0] || forecastData.daily.time[0] === selectedDay)
    ? forecastData.daily : undefined;
  const hourly = forecastData.hourly;
  const current = currentData?.error ? undefined : currentData?.current;
  const byInstant = new Map<number, HourForecast>();
  if (Array.isArray(hourly?.time)) {
    hourly.time.forEach((raw, i) => {
      if (typeof raw !== 'string' && !finite(raw)) return;
      const zoned = /(?:Z|[+-]\d{2}:\d{2})$/i.test(String(raw));
      const startsAt = finite(raw) ? raw * 1000 : zoned ? Date.parse(String(raw))
        : finite(offset) ? Date.parse(`${raw}Z`) - offset * 1000 : NaN;
      if (!Number.isFinite(startsAt)) return;
      const at = new Date(startsAt);
      if (dayKey(at) !== selectedDay) return;
      const hour = at.getHours();
      const temp = hourly.temperature_2m?.[i];
      const code = hourly.weather_code?.[i];
      const rainProb = hourly.precipitation_probability?.[i];
      const rainMm = hourly.precipitation?.[i];
      const wind = hourly.wind_speed_10m?.[i];
      // Missing hours stay missing; never turn a gap in the forecast into dry weather.
      if (hour < 0 || hour > 23 || !finite(temp) || !finite(code)
        || !finite(rainProb) || !finite(rainMm) || !finite(wind)) return;
      byInstant.set(startsAt, {
        startsAt, hour, label: at.toLocaleTimeString(activeLocale(), { hour: '2-digit', minute: '2-digit' }), temperature_2m: temp, weather_code: code,
        precipitation_probability: rainProb, precipitation: rainMm, wind_speed_10m: wind,
        is_day: hourly.is_day?.[i] ?? 1,
      });
    });
  }
  const hours = [...byInstant.values()].sort((a, b) => a.startsAt - b.startsAt);
  const max = (values: unknown[]) => {
    const numbers = values.filter(finite);
    return numbers.length ? Math.round(Math.max(...numbers)) : null;
  };
  const weatherCode = finite(daily?.weather_code?.[0]) ? daily.weather_code[0] : hours[0]?.weather_code;
  const high = finite(daily?.temperature_2m_max?.[0]) ? Math.round(daily.temperature_2m_max[0]) : max(hours.map(h => h.temperature_2m));
  if (high == null && weatherCode == null && hours.length === 0) return null;
  const maxRainChance = max([daily?.precipitation_probability_max?.[0], ...hours.map(h => h.precipitation_probability)]);
  const maxWindSpeed = max([daily?.wind_speed_10m_max?.[0], ...hours.map(h => h.wind_speed_10m)]);
  const headline = current?.temperature_2m ?? hours.find(h => h.hour === 13)?.temperature_2m ?? hours[0]?.temperature_2m ?? high;
  const headlineTemp = finite(headline) ? Math.round(headline) : null;
  return {
    headlineTemp, weatherCode,
    maxRainChance, maxWindSpeed, hours,
  };
}

export function WeatherPage() {
  usePageWidth('wide');
  const [windOpen, setWindOpen] = useState(false);
  const { t, locale } = useLanguage();
  const { competition, reload } = useCompetition();
  const { canOrganise, hasRole } = useAuth();
  const [refreshVersion, setRefreshVersion] = useState(0);
  const refresh = useCallback(() => {
    reload();
    setRefreshVersion(version => version + 1);
  }, [reload]);
  usePageHeader({
    title: t('teams.weather.title'),
    subtitle: competition.name,
    backTo: `/competitions/${competition.id}`,
    backLabel: t('teams.weather.backToTimetable'),
    onRefresh: refresh,
    refreshLabel: t('teams.weather.refresh'),
  });

  const timings = useMemo(() => computeTimings(competition.sessions), [competition.sessions]);
  const rows = useMemo(() => timetableRows(competition.sessions, timings, true), [competition.sessions, timings]);

  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const today = dayKey(new Date());
  const startDay = eventCalendarDay(competition.startDate);
  const endDay = eventCalendarDay(competition.endDate ?? competition.startDate);
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
  const requestKey = `${lat}|${lon}|${selectedDay}|${refreshVersion}`;
  const [fetched, setFetched] = useState<{
    key: string;
    forecast: ForecastApiResponse | null;
    current: CurrentApiResponse | null;
    receivedAt: Date;
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
      selectedDay === today ? api
        .get<CurrentApiResponse>('/weather/current', {
          params: { lat, lon },
        })
        .then((res) => res.data)
        .catch(() => null) : Promise.resolve(null),
    ]).then(([forecast, current]) => {
      if (!cancelled) {
        setFetched({ key: requestKey, forecast, current, receivedAt: new Date() });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [lat, lon, selectedDay, requestKey, today]);

  const activeForecast = fetched?.key === requestKey ? fetched.forecast : null;
  const activeCurrent = fetched?.key === requestKey ? fetched.current : null;
  const weather = buildDayWeather(activeForecast, activeCurrent, selectedDay);

  const updatedText = weather && fetched?.key === requestKey
    ? fetched.receivedAt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : null;
  const selectedDateLabel = selectedDay
    ? new Date(`${selectedDay}T12:00:00`).toLocaleDateString(locale, {
        weekday: 'long',
        day: 'numeric',
        month: 'short',
      })
    : '';

  // Thunder or heavy rain on the day: organisers get a quiet way to the announcements page.
  const badWeather = !competition.isIndoor && !!weather?.hours.some((hour) => hazardOf({ startsAt: hour.startsAt, weatherCode: hour.weather_code, rainMm: hour.precipitation, rainChance: hour.precipitation_probability }) != null);
  const mayOrganise = canOrganise(competition) && hasRole('Admin');
  const isToday = selectedDay === today;
  const nowLabel = isToday ? t('teams.weather.now') : selectedDateLabel;

  return (
    <div className="rf-page mx-auto flex w-full max-w-xl flex-col pb-8 pt-3">
      <h1 className="sr-only">{t('teams.weather.title')}</h1>
      {canOrganise(competition) && <button className="kit-pill mb-3" onClick={() => setWindOpen(true)}>{t('wind.review')}</button>}
      {windOpen && <WindReviewSheet competition={competition} prompt={null} hours={parseForecastHours(activeForecast)} reload={reload} onClose={() => setWindOpen(false)} />}
      {days.length > 1 && (
        <div className="sp-seg mb-3" role="tablist" aria-label={t('teams.weather.chooseDay')}>
          {days.map((day, index) => {
            const shortDay = new Date(`${day}T12:00:00`).toLocaleDateString(locale, { weekday: 'short' });
            return (
              <button key={day} type="button" role="tab" aria-selected={selectedDay === day} onClick={() => setPickedDay(day)}>
                {t('teams.weather.dayN', { number: index + 1, day: shortDay })}
              </button>
            );
          })}
        </div>
      )}

      <div key={selectedDay} className="mg-swap">
      {badWeather && mayOrganise && (
        <Link to={`/competitions/${competition.id}/announcements`} className="mg-text-link mb-3 inline-flex min-h-11 items-center">{t('teams.weather.organiserAction')}</Link>
      )}
      <section aria-label={t('teams.weather.summary')} className={weather ? 'ev-card flex items-center gap-4 p-4' : undefined}>
        {!weather ? (
          lat == null || lon == null ? (
            <Notice tone="info" actionLabel={canOrganise(competition) ? t('teams.weather.setLocation') : undefined} actionTo={canOrganise(competition) ? `/competitions/${competition.id}/event-details` : undefined}>{t('teams.weather.noLocation')}</Notice>
          )
            : fetched?.key !== requestKey ? <Notice tone="info">{t('teams.weather.loading')}</Notice>
              : <Notice actionLabel={t('common.tryAgain')} onAction={refresh}>{t('teams.weather.error')}</Notice>
        ) : <>
          <WeatherIcon code={weather.weatherCode} className="h-16 w-16" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="sp-t2">{nowLabel}{updatedText ? ` · ${t('teams.weather.updated', { time: updatedText })}` : ''}</span>
            <span className="mg-display text-[44px] font-extrabold leading-none text-[rgb(var(--mg-heading))]">
              {weather.headlineTemp == null ? '—' : `${weather.headlineTemp}°`}
            </span>
            <span className="sp-t1">{t(weatherConditionKey(weather.weatherCode))}</span>
            <span className="sp-t2">
              {[weather.maxRainChance == null ? null : t('teams.weather.rainChance', { percent: weather.maxRainChance }), weather.maxWindSpeed == null ? null : t('teams.weather.windUpTo', { speed: weather.maxWindSpeed })].filter(Boolean).join(' · ') || t('teams.weather.rainWindUnavailable')}
            </span>
          </div>
        </>}
      </section>

      {activeForecast?.gustIntervals && <section className="ev-card p-4" aria-label={t('wind.forecast')}>
        <details><summary className="sp-t1">{t('wind.forecast')}</summary>
        {activeForecast.fetchedAt && <p className="sp-note">{t('wind.updated', { time: formatTime(new Date(activeForecast.fetchedAt)) })}</p>}
        {activeForecast.gustIntervals.filter(g => venueDay(new Date((g.endsAt - 1) * 1000), activeForecast.timezone) === selectedDay).map(g =>
          <p className="sp-t2" key={g.endsAt}>{formatTime(new Date(g.startsAt * 1000))}–{formatTime(new Date(g.endsAt * 1000))} · {t('wind.peak', { speed: Math.round(g.gustMph) })}</p>)}
        </details><p className="sp-note">{t('wind.awareness')}</p>
      </section>}
      <section aria-label={t('teams.weather.timetableAria')}>
        <h2 className="sp-sec">{t('teams.weather.throughDay')}</h2>
        {dayRows.length === 0 ? (
          <p className="sp-note">{t('teams.weather.nothing')}</p>
        ) : (
          <div className="sp-card">
            {dayRows.map((row) => {
              const instant = row.effective?.getTime();
              const rowWeather = instant == null ? undefined
                : weather?.hours.find(hour => hour.startsAt <= instant && instant < hour.startsAt + 3_600_000);
              const race = (row.session.kind ?? (row.session.isBreak ? 1 : 0)) === 0;
              const heatName = row.heat ? row.heat.label || t('teams.team.heatN', { number: row.heatIndex + 1 }) : row.session.name;
              const sectionText = row.session.sectionName ? displaySectionName(row.session.sectionName) : '';
              // A heat reads "Under 12 · Heat 1"; a session with no heats already names its age group.
              const title = race && row.heat ? [sectionText, heatName].filter(Boolean).join(' · ') : heatName;
              const words = rowWeather
                ? [t(weatherConditionKey(rowWeather.weather_code)), rowWeather.precipitation_probability >= 20 ? t('teams.weather.rainChance', { percent: Math.round(rowWeather.precipitation_probability) }) : null].filter(Boolean).join(', ')
                : weather ? t('teams.weather.rowUnavailable') : '';

              const inner = (
                <>
                  <span className="w-[46px] shrink-0 mg-display text-xl font-bold leading-none text-[rgb(var(--mg-heading))]">{formatTime(row.effective)}</span>
                  <span className="sp-grow"><span className="sp-t1 !text-[15px]">{title}</span>{words && <span className="sp-t2">{words}</span>}</span>
                  {rowWeather && <WeatherIcon code={rowWeather.weather_code} isDay={rowWeather.is_day !== 0} className="h-9 w-9" />}
                  {rowWeather && <span className="w-10 shrink-0 text-right mg-display text-lg font-bold">{`${Math.round(rowWeather.temperature_2m)}°`}</span>}
                  {race ? <ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} /> : <span className="h-4 w-4 shrink-0" aria-hidden="true" />}
                </>
              );
              return race ? (
                <Link key={row.key} className="sp-row !gap-2.5" to={`/competitions/${competition.id}/session/${row.session.id}${row.heat ? `?heat=${row.heat.id}` : ''}`}>{inner}</Link>
              ) : (
                <div key={row.key} className="sp-row !gap-2.5">{inner}</div>
              );
            })}
          </div>
        )}
      </section>
      </div>
    </div>
  );
}
