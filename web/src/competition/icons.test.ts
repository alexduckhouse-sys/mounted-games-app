import { describe, expect, it } from 'vitest';
import { COMPETITION_ICONS, competitionIcon } from './icons';

describe('competitionIcon', () => {
  it('finds an icon by id', () => {
    expect(competitionIcon('ie')).toEqual({ id: 'ie', symbol: '🇮🇪', label: 'Ireland' });
  });

  it('falls back to the chequered flag for unknown, empty or missing ids', () => {
    for (const id of ['nope', '', null, undefined]) expect(competitionIcon(id)).toBe(COMPETITION_ICONS[0]);
  });
});
