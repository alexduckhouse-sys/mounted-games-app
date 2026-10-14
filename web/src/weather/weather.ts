import { api } from '../api';
import { createRequestCache, WEATHER_REFRESH_MS } from './requestCache';

const request = createRequestCache();
export function getWeather<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const key = `${path}:${JSON.stringify(Object.entries(params).sort())}`;
  return request(key, async () => {
    const response = await api.get<T & { error?: string; fallback?: unknown }>(path, { params });
    if (response.data.error || response.data.fallback) throw new Error('Weather is unavailable');
    if (response.headers['x-mg-saved-copy'] === '1') {
      const savedAt = Date.parse(String(response.headers['x-mg-saved-at'] ?? ''));
      if (!Number.isFinite(savedAt) || Date.now() - savedAt >= WEATHER_REFRESH_MS) throw new Error('Saved weather is out of date');
    }
    return response.data;
  });
}
