import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COUNTRY_FLAGS } from './countries';
import { COMPETITION_ICONS, EMOJI_COMPETITION_ICONS, FLAG_COMPETITION_ICONS, OTHER_FLAG_ICONS, UK_FLAG_ICONS, competitionIcon } from './icons';

describe('competitionIcon', () => {
  it('finds an emoji icon by id', () => {
    expect(competitionIcon('trophy')).toEqual({ id: 'trophy', symbol: '🏆', label: 'Trophy' });
  });

  it('finds a flag image by id', () => {
    expect(competitionIcon('ie')).toEqual({ id: 'ie', src: '/flags/ie.png', label: 'Ireland' });
    expect(competitionIcon('gb-sct')).toEqual({ id: 'gb-sct', src: '/flags/gb-sct.png', label: 'Scotland' });
  });

  it('falls back to the chequered flag for unknown, empty or missing ids', () => {
    for (const id of ['nope', 'xx', '', null, undefined]) expect(competitionIcon(id)).toBe(COMPETITION_ICONS[0]);
    expect(COMPETITION_ICONS[0]).toMatchObject({ id: 'flag', symbol: '🏁' });
  });
});

describe('COMPETITION_ICONS', () => {
  it('offers exactly the ids the API accepts', () => {
    // The API's pattern is the one list of allowed ids: read it from the source so the two can't drift apart.
    const source = readFileSync(resolve(process.cwd(), '../api/Dtos/ApiDtos.cs'), 'utf8');
    const pattern = /public const string Pattern = "\^\(([^)]+)\)\\\\z";/.exec(source);
    expect(pattern).not.toBeNull();
    expect(COMPETITION_ICONS.map((icon) => icon.id).sort()).toEqual(pattern![1].split('|').sort());
  });

  it('has a flag for every country', () => {
    expect(COUNTRY_FLAGS.length).toBeGreaterThanOrEqual(249);
    expect(new Set(COUNTRY_FLAGS.map(([code]) => code)).size).toBe(COUNTRY_FLAGS.length);
    for (const code of ['ie', 'fr', 'af', 'zw', 'xk', 'us', 'jp']) expect(COUNTRY_FLAGS.map(([c]) => c)).toContain(code);
  });

  it('lists emoji first, then the UK flags, then the other flags alphabetically', () => {
    expect(EMOJI_COMPETITION_ICONS.map((icon) => icon.id)).toEqual(['flag', 'world', 'trophy']);
    expect(UK_FLAG_ICONS.map((icon) => icon.label)).toEqual(['United Kingdom', 'England', 'Scotland', 'Wales', 'Northern Ireland']);
    const labels = OTHER_FLAG_ICONS.map((icon) => icon.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, 'en-GB')));
    expect(FLAG_COMPETITION_ICONS).toEqual([...UK_FLAG_ICONS, ...OTHER_FLAG_ICONS]);
    expect(COMPETITION_ICONS).toEqual([...EMOJI_COMPETITION_ICONS, ...FLAG_COMPETITION_ICONS]);
  });

  it('points every flag at an image that is bundled', () => {
    const png = new Set(['at', 'au', 'be', 'ca', 'ch', 'cz', 'de', 'dk', 'es', 'fi', 'fr', 'gb', 'gb-eng', 'gb-nir', 'gb-sct', 'gb-wls', 'ie', 'it', 'nl', 'no', 'nz', 'pl', 'pt', 'se', 'us', 'za']);
    for (const icon of FLAG_COMPETITION_ICONS) {
      expect(icon.src).toBe(`/flags/${icon.id}.${png.has(icon.id) ? 'png' : 'svg'}`);
      expect(existsSync(resolve(process.cwd(), `public${icon.src}`))).toBe(true);
    }
  });
});
