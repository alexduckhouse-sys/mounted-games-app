import { describe, expect, it } from 'vitest';
import { translate } from '../i18n/translate';
import type { Lang } from '../i18n/translate';
import type { ToplistRow } from './toplist';
import { ordinalText, resultStatusText, sessionColumnTitle, toplistNoteText, toplistNoteTone } from './toplistText';
import { ordinal, toplistNote } from './toplist';

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
  it('says nothing when there is nothing to say: ties, run-offs and races left are not written out', () => {
    expect(toplistNoteText(row(), tIn('en'))).toBeNull();
    expect(toplistNoteText(row({ runoff: true, joint: true, position: 3 }), tIn('en'))).toBeNull();
    expect(toplistNoteText(row({ racesLeft: 3 }), tIn('en'))).toBeNull();
  });

  it('matches the English notes word for word', () => {
    const en = tIn('en');
    expect(toplistNoteText(row({ withdrawn: true, guaranteed: true }), en)).toBe('Withdrawn');
    expect(toplistNoteText(row({ neededUnavailable: true }), en)).toBe('Qualification calculation unavailable');
    expect(toplistNoteText(row({ guaranteed: true, racesLeft: 2 }), en)).toBe('Guaranteed a place in the A Final');
    expect(toplistNoteText(row({ toStay: 3, racesLeft: 2 }), en)).toBe('3 pts to stay in the A Final');
    expect(toplistNoteText(row({ toStay: 1, racesLeft: 1 }), en)).toBe('1 pt to stay in the A Final');
    expect(toplistNoteText(row({ needed: 4 }), en)).toBe('4 pts needed for the A Final (normal finishes)');
    expect(toplistNoteText(row({ needed: 1 }), en)).toBe('1 pt needed for the A Final (normal finishes)');
    expect(toplistNoteText(row({ needed: 2, neededForRunoff: true }), en)).toBe('2 pts needed for a run-off (normal finishes)');
    expect(toplistNoteText(row({ toStay: 3, bonus: 2 }), en)).toBe('3 pts to stay in the A Final · 2 tack bonus points');
    expect(toplistNoteText(row({ bonus: 1 }), en)).toBe('1 tack bonus point');
  });

  it('agrees with the English note used by the embed wherever both say something', () => {
    for (const extra of [{ guaranteed: true }, { toStay: 4 }, { toStay: 1 }, { needed: 5 }, { needed: 1, neededForRunoff: true }, { neededUnavailable: true }, { withdrawn: true }]) {
      expect(toplistNoteText(row(extra), tIn('en'))).toBe(toplistNote(row(extra)));
    }
  });

  it('translates the notes', () => {
    expect(toplistNoteText(row({ guaranteed: true }), tIn('fr'))).toBe('Place assurée en finale A');
    expect(toplistNoteText(row({ toStay: 2 }), tIn('fr'))).toBe('2 pts pour rester en finale A');
    expect(toplistNoteText(row({ needed: 1 }), tIn('fr'))).toBe('Il faut 1 pt pour la finale A (arrivées normales)');
    expect(toplistNoteText(row({ toStay: 2 }), tIn('cy'))).toBe('2 pwynt i aros yn Rownd Derfynol A');
    expect(toplistNoteText(row({ guaranteed: true }), tIn('cy'))).toBe('Lle yn Rownd Derfynol A yn sicr');
    expect(toplistNoteText(row({ withdrawn: true }), tIn('cy'))).toBe('Wedi tynnu’n ôl');
  });
});

describe('toplistNoteTone', () => {
  it('is green for a guaranteed place, amber for points still to get and plain otherwise', () => {
    expect(toplistNoteTone(row({ guaranteed: true }))).toBe('safe');
    expect(toplistNoteTone(row({ toStay: 2 }))).toBe('need');
    expect(toplistNoteTone(row({ needed: 0 }))).toBe('need');
    expect(toplistNoteTone(row({ needed: 3, neededUnavailable: true }))).toBeNull();
    expect(toplistNoteTone(row({ guaranteed: true, withdrawn: true }))).toBeNull();
    expect(toplistNoteTone(row({ toStay: null }))).toBeNull();
    expect(toplistNoteTone(row())).toBeNull();
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
