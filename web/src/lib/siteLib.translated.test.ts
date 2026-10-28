import { afterEach, describe, expect, it } from 'vitest';
import { setActiveLang } from '../i18n/translate';
import { runLabels } from './profileStats';
import { finalLabel, gameLine, ordinalPlace, pointsOf, STATS_KIND_LABELS, STATS_TABS } from './stats';
import { sectionFormatText } from './sectionFormatText';
import { PRICE_BANDS, shopFilterChips, NO_SHOP_FILTERS } from './shopFilters';
import { translate } from '../i18n/translate';

afterEach(() => setActiveLang('en'));

describe('stats and shop helpers in other languages', () => {
  it('speaks French', () => {
    setActiveLang('fr');
    expect(ordinalPlace(1)).toBe('1er');
    expect(finalLabel(0)).toBe('Finale A');
    expect(pointsOf(3, 6)).toBe('3 sur 6 points');
    expect(STATS_KIND_LABELS[1]).toBe('Poney');
    expect(STATS_TABS[3].label).toBe('Clubs');
    expect(gameLine({ name: 'Bending', races: 2, wins: 1, points: 8, averagePlace: null } as never)).toBe('2 courses · 1 victoire · moyenne 4 pts');
    expect(runLabels([{ competitionName: 'National', startDate: '2026-08-03T10:00:00Z' } as never])[0][1]).toMatch(/^août/);
    expect(PRICE_BANDS[1].label).toBe('Moins de 25 £');
    expect(shopFilterChips({ ...NO_SHOP_FILTERS, photoOnly: true })[0].label).toBe('Avec photo');
  });

  it('speaks Welsh', () => {
    setActiveLang('cy');
    expect(ordinalPlace(2)).toBe('2il');
    expect(STATS_KIND_LABELS[0]).toBe('Marchog');
    expect(STATS_TABS[1].plural).toBe('merlod');
    expect(runLabels([{ competitionName: 'National', startDate: '2026-08-03T10:00:00Z' } as never])[0]).toHaveLength(2);
  });

  it('names section formats', () => {
    const t = (lang: 'en' | 'fr') => (key: Parameters<typeof translate>[1]) => translate(lang, key);
    expect([1, 2, 3].map((format) => sectionFormatText(format as 1 | 2 | 3, t('en')))).toEqual(['Pairs', 'Teams', 'Individual']);
    expect(sectionFormatText(1, t('fr'))).toBe('Paires');
  });
});
