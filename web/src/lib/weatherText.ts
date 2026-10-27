import type { MessageKey } from '../i18n/en';

/** The catalogue key for the words that go with a forecast code (Open-Meteo's WMO codes). */
export function weatherConditionKey(code?: number | null): MessageKey {
  if (code == null) return 'teams.weather.unavailable';
  if (code === 0) return 'teams.weather.sunny';
  if (code === 1) return 'teams.weather.mainlyClear';
  if (code === 2) return 'teams.weather.partlyCloudy';
  if (code === 3) return 'teams.weather.overcast';
  if (code <= 49) return 'teams.weather.foggy';
  if (code <= 59) return 'teams.weather.drizzle';
  if (code <= 64) return 'teams.weather.lightRain';
  if (code <= 69) return 'teams.weather.heavyRain';
  if (code <= 79) return 'teams.weather.snow';
  if (code <= 84) return 'teams.weather.showers';
  if (code <= 86) return 'teams.weather.snowShowers';
  if (code <= 99) return 'teams.weather.thunderstorm';
  return 'teams.weather.partlyCloudy';
}
