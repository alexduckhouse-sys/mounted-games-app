import { describe, expect, it } from 'vitest';
import { formatPoints } from './formatPoints';

describe('formatPoints', () => {
  it('shows whole values without a decimal point', () => {
    expect(formatPoints(3)).toBe('3');
    expect(formatPoints(0)).toBe('0');
    expect(formatPoints(-0)).toBe('0');
  });
  it('shows halves with one decimal place', () => {
    expect(formatPoints(2.5)).toBe('2.5');
    expect(formatPoints(10.5)).toBe('10.5');
    expect(formatPoints(0.5)).toBe('0.5');
  });
  it('snaps float noise to the nearest half and ignores non-numbers', () => {
    expect(formatPoints(2.4999999)).toBe('2.5');
    expect(formatPoints(3.0000001)).toBe('3');
    expect(formatPoints(Number.NaN)).toBe('');
  });
});
