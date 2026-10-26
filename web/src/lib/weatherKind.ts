export type WeatherKind = 'sun' | 'moon' | 'part' | 'cloud' | 'fog' | 'rain' | 'snow' | 'storm';

/** Which picture goes with a forecast code (Open-Meteo's WMO codes). Night skies get a moon. */
export function weatherKind(code: number | undefined, isDay = true): WeatherKind {
  if (code == null || code === 3) return 'cloud';
  if (code <= 1) return isDay ? 'sun' : 'moon';
  if (code === 2) return 'part';
  if (code <= 49) return 'fog';
  if (code <= 69) return 'rain';
  if (code <= 79) return 'snow';
  if (code <= 84) return 'rain';
  if (code <= 86) return 'snow';
  return 'storm';
}
