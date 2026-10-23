import { describe, expect, it } from 'vitest';
import source from './CompetitionEditor.tsx?raw';

// The default race lists are private constants of the editor, so read them from its source.

function listNamed(name: string): string[] {
  const match = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\n\\];`).exec(source);
  if (!match) throw new Error(`${name} not found`);
  return [...match[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
}

describe('default pairs race lists', () => {
  for (const name of ['ZONE_PAIRS', 'AREA_PAIRS']) {
    it(`${name} has no race twice in a row`, () => {
      const races = listNamed(name);
      expect(races.length).toBeGreaterThan(5);
      races.forEach((race, i) => {
        if (i > 0) expect(race, `${race} at position ${i + 1}`).not.toBe(races[i - 1]);
      });
    });
  }

  it('lists the Zone pairs races once each', () => {
    expect(listNamed('ZONE_PAIRS')).toEqual([
      'Bending', 'Hollywood Bowl Boule & Bucket', 'Bottle', 'Litter', 'Tally Ho Farm Ball & Socket', 'STRUK Pole',
      'PGSports UK Shopping Spree', 'Stepping Stones', 'EGUK Mug Changes', '5 Flag',
    ]);
  });

  it('lists the Area pairs races once each', () => {
    expect(listNamed('AREA_PAIRS')).toEqual([
      'Bending', '2 Mug', 'Old Sock', 'Tally Ho Farm Ball & Socket', 'PGUK Pyramid', 'Hollywood Bowl Bottle', 'Stepping Stones', 'EGUK 5 Flag',
    ]);
  });
});
