import { describe, expect, it } from 'vitest';
import { placesLeftText } from './placesLeft';

const sec = (format: number, maxParticipants: number | null | undefined, activeSignupsCount: number | null | undefined) => ({ format, maxParticipants, activeSignupsCount }) as never;

describe('placesLeftText', () => {
  it('uses the right noun and plural', () => {
    expect(placesLeftText(sec(2, 10, 4))).toBe('6 team places left');
    expect(placesLeftText(sec(1, 10, 4))).toBe('6 pair places left');
    expect(placesLeftText(sec(3, 10, 4))).toBe('6 rider places left');
    expect(placesLeftText(sec(2, 10, 9))).toBe('1 team place left');
  });
  it('falls back to a plain noun for an unknown format', () => {
    expect(placesLeftText(sec(9, 10, 8))).toBe('2 places left');
    expect(placesLeftText(sec(9, 10, 9))).toBe('1 place left');
  });
  it('says nothing when full, uncapped, unknown or closed', () => {
    expect(placesLeftText(sec(2, 10, 10))).toBeNull();
    expect(placesLeftText(sec(2, 10, 12))).toBeNull();
    expect(placesLeftText(sec(2, null, 3))).toBeNull();
    expect(placesLeftText(sec(2, 10, undefined))).toBeNull();
    expect(placesLeftText(sec(2, 10, 4), true)).toBeNull();
  });
});
