import { afterEach, describe, expect, it } from 'vitest';
import { setActiveLang, translate, type Translate } from '../i18n/translate';
import { embedToplistNote, timetableStatusText } from './embedText';
import type { ToplistRow } from './toplist';

const row = (extra: Partial<ToplistRow>) => ({ position: 2, bonus: 0, racesLeft: 0, withdrawn: false, runoff: false, ...extra }) as ToplistRow;
const en: Translate = (key, values) => translate('en', key, values);
const fr: Translate = (key, values) => translate('fr', key, values);

afterEach(() => setActiveLang('en'));

describe('embedToplistNote', () => {
  it('reads like the toplist note in English', () => {
    expect(embedToplistNote(row({ withdrawn: true }), en)).toBe('Withdrawn');
    expect(embedToplistNote(row({ runoff: true }), en)).toBe('Joint 2nd · run-off');
    expect(embedToplistNote(row({ neededUnavailable: true }), en)).toBe('Qualification calculation unavailable');
    expect(embedToplistNote(row({ guaranteed: true }), en)).toBe('Guaranteed a place in the A Final');
    expect(embedToplistNote(row({ toStay: 1 }), en)).toBe('1 pt to stay in the A Final');
    expect(embedToplistNote(row({ needed: 4 }), en)).toBe('4 pts needed for the A Final (normal finishes)');
    expect(embedToplistNote(row({ needed: 4, neededForRunoff: true }), en)).toBe('4 pts needed for a run-off (normal finishes)');
    expect(embedToplistNote(row({ racesLeft: 2, bonus: 1, tieBreakReason: 'Countback' }), en)).toBe('2 races left · Countback · 1 tack bonus point');
    expect(embedToplistNote(row({}), en)).toBeNull();
  });

  it('speaks French', () => {
    setActiveLang('fr');
    expect(embedToplistNote(row({ runoff: true }), fr)).toBe('2e ex æquo · barrage');
  });
});

describe('timetableStatusText', () => {
  it('names each state', () => {
    expect(timetableStatusText('finished', 0, en)).toBe('Finished');
    expect(timetableStatusText('live', 0, en)).toBe('On now');
    expect(timetableStatusText('on-time', 0, en)).toBe('On time');
    expect(timetableStatusText('late', 10, fr)).toMatch(/^\+/);
    expect(timetableStatusText('finished', 0, fr)).toBe('Terminé');
  });
});
