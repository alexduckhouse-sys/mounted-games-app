import { describe, expect, it } from 'vitest';
import { translate } from '../i18n/translate';
import type { Lang } from '../i18n/translate';
import type { ToplistRow } from './toplist';
import { ordinalText, resultStatusText, sessionColumnTitle, toplistNoteText } from './toplistText';
import { ordinal } from './toplist';

const tIn = (lang: Lang) => (key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) => translate(lang, key, values);

const row = (extra: Partial<ToplistRow> = {}): ToplistRow => ({
  teamId: 1, teamName: 'Oak A', points: 4, position: 2, joint: false, runoff: false, racesLeft: 0, withdrawn: false,
  needed: null, neededForRunoff: false, neededUnavailable: false, bonus: 0, ...extra,
} as ToplistRow);

describe('ordinalText', () => {
  it('matches the English ordinal for English', () => {
    for (const n of [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111]) expect(ordinalText(n, 'en')).toBe(ordinal(n));
  });

  it('writes Welsh ordinals up to twenty and falls back to "ain" after that', () => {
    expect(ordinalText(1, 'cy')).toBe('1af');
    expect(ordinalText(2, 'cy')).toBe('2il');
    expect(ordinalText(3, 'cy')).toBe('3ydd');
    expect(ordinalText(20, 'cy')).toBe('20fed');
    expect(ordinalText(21, 'cy')).toBe('21ain');
  });

  it('writes French ordinals', () => {
    expect(ordinalText(1, 'fr')).toBe('1er');
    expect(ordinalText(2, 'fr')).toBe('2e');
    expect(ordinalText(12, 'fr')).toBe('12e');
  });
});

describe('toplistNoteText', () => {
  it('says nothing when there is nothing to say', () => {
    expect(toplistNoteText(row(), tIn('en'), 'en')).toBeNull();
  });

  it('matches the English notes word for word', () => {
    const en = tIn('en');
    expect(toplistNoteText(row({ withdrawn: true }), en, 'en')).toBe('Withdrawn');
    expect(toplistNoteText(row({ runoff: true, position: 3 }), en, 'en')).toBe('Joint 3rd · run-off');
    expect(toplistNoteText(row({ neededUnavailable: true }), en, 'en')).toBe('Qualification calculation unavailable');
    expect(toplistNoteText(row({ needed: 4 }), en, 'en')).toBe('4 needed to make the final (normal finishes)');
    expect(toplistNoteText(row({ needed: 2, neededForRunoff: true }), en, 'en')).toBe('2 needed for a run-off (normal finishes)');
    expect(toplistNoteText(row({ racesLeft: 1 }), en, 'en')).toBe('1 race left');
    expect(toplistNoteText(row({ racesLeft: 3, bonus: 2 }), en, 'en')).toBe('3 races left · 2 tack bonus points');
    expect(toplistNoteText(row({ bonus: 1 }), en, 'en')).toBe('1 tack bonus point');
  });

  it('translates the notes', () => {
    expect(toplistNoteText(row({ racesLeft: 3 }), tIn('cy'), 'cy')).toBe('3 ras ar ôl');
    expect(toplistNoteText(row({ racesLeft: 1 }), tIn('fr'), 'fr')).toBe('1 course restante');
    expect(toplistNoteText(row({ runoff: true, position: 2 }), tIn('fr'), 'fr')).toBe('2e ex æquo · barrage');
    expect(toplistNoteText(row({ withdrawn: true }), tIn('cy'), 'cy')).toBe('Wedi tynnu’n ôl');
  });
});

describe('sessionColumnTitle', () => {
  it('translates the titles the toplist builds and keeps anything else', () => {
    const fr = tIn('fr');
    expect(sessionColumnTitle('Session 2', fr)).toBe('Session 2');
    expect(sessionColumnTitle('Session 2', tIn('cy'))).toBe('Sesiwn 2');
    expect(sessionColumnTitle('Finals', fr)).toBe('Finales');
    expect(sessionColumnTitle('Tack check bonus points', tIn('en'))).toBe('Tack check bonus points');
    expect(sessionColumnTitle('Something else', fr)).toBe('Something else');
  });
});

describe('resultStatusText', () => {
  it('names each way of not finishing in the chosen language', () => {
    expect(resultStatusText(false, undefined, tIn('en'))).toBeNull();
    expect(resultStatusText(true, undefined, tIn('en'))).toBe('Eliminated');
    expect(resultStatusText(true, 1, tIn('en'))).toBe('Eliminated');
    expect(resultStatusText(true, 2, tIn('en'))).toBe('Did not start');
    expect(resultStatusText(true, 3, tIn('en'))).toBe('Did not finish');
    expect(resultStatusText(true, 4, tIn('en'))).toBe('Retired');
    expect(resultStatusText(true, 2, tIn('cy'))).toBe('Heb ddechrau');
    expect(resultStatusText(true, 4, tIn('fr'))).toBe('Abandon');
  });
});
