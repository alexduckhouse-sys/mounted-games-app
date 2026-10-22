import { describe, expect, it } from 'vitest';
import { encode } from 'uqr';
import { qrShape } from './qr';

/** Reads the dark modules back out of path data made by qrShape. */
function darkModules(path: string): Set<string> {
  const dark = new Set<string>();
  for (const [, x, y, length] of Array.from(path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g), (m) => m.map(Number))) {
    for (let i = 0; i < length; i++) dark.add(`${x + i},${y}`);
  }
  return dark;
}

describe('qrShape', () => {
  it('draws exactly the modules of the encoded code', () => {
    const text = 'https://mg.example/competitions/12';
    const shape = qrShape(text)!;
    const expected = encode(text, { ecc: 'M', border: 0 }).data;
    expect(shape.size).toBe(expected.length);
    const dark = darkModules(shape.path);
    for (let y = 0; y < expected.length; y++) {
      for (let x = 0; x < expected.length; x++) expect(dark.has(`${x},${y}`)).toBe(expected[y][x]);
    }
  });

  it('puts the three finder squares in the corners', () => {
    const { size, path } = qrShape('https://mg.example/teams?join=ABCD2345')!;
    const dark = darkModules(path);
    for (const [cx, cy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
      // A finder pattern is a 7x7 ring with a 3x3 centre: its corners and middle are dark.
      for (const [dx, dy] of [[0, 0], [6, 0], [0, 6], [6, 6], [3, 3]]) expect(dark.has(`${cx + dx},${cy + dy}`)).toBe(true);
      expect(dark.has(`${cx + 1},${cy + 1}`)).toBe(false);
    }
  });

  it('is deterministic and grows with the text', () => {
    expect(qrShape('abc')).toEqual(qrShape('abc'));
    expect(qrShape('x'.repeat(200))!.size).toBeGreaterThan(qrShape('x')!.size);
  });

  it('returns null for empty text and for text too long for any code', () => {
    expect(qrShape('')).toBeNull();
    expect(qrShape('x'.repeat(5000))).toBeNull();
  });
});
