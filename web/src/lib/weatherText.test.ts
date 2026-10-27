import { describe, expect, it } from 'vitest';
import { translate, type Lang } from '../i18n/translate';
import { weatherConditionKey } from './weatherText';

const words = (lang: Lang, code?: number | null) => translate(lang, weatherConditionKey(code));

describe('weatherConditionKey', () => {
  it('keeps the English words the weather page always used', () => {
    expect([undefined, null, 0, 1, 2, 3, 45, 53, 61, 67, 75, 81, 85, 95, 120].map((code) => words('en', code))).toEqual([
      'Conditions unavailable', 'Conditions unavailable', 'Sunny', 'Mainly clear', 'Partly cloudy', 'Overcast', 'Foggy', 'Light drizzle', 'Light rain', 'Heavy rain', 'Snow', 'Rain showers', 'Snow showers', 'Thunderstorm', 'Partly cloudy',
    ]);
  });

  it('has words in Welsh and French for every group of codes', () => {
    for (const code of [undefined, 0, 1, 2, 3, 45, 53, 61, 67, 75, 81, 85, 95]) {
      expect(words('cy', code)).not.toBe(words('en', code));
      expect(words('fr', code)).not.toBe(words('en', code));
    }
  });
});
