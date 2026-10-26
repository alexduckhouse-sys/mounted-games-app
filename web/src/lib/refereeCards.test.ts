import { describe, expect, it } from 'vitest';
import { afterRed, afterYellow, redLabel, stepPoints, yellowLabel } from './refereeCards';

describe('cards', () => {
  it('turns a second yellow into a red, and a red back to yellow', () => {
    expect(afterYellow(null)).toBe('yellow');
    expect(afterYellow('yellow')).toBe('red');
    expect(afterYellow('red')).toBe('yellow');
  });

  it('gives a red card and takes it off again', () => {
    expect(afterRed(null)).toBe('red');
    expect(afterRed('yellow')).toBe('red');
    expect(afterRed('red')).toBeNull();
  });

  it('words the menu items for what they will do', () => {
    expect(yellowLabel(null)).toBe('Yellow card');
    expect(yellowLabel('red')).toBe('Yellow card');
    expect(yellowLabel('yellow')).toBe('Second yellow (red card)');
    expect(redLabel(null)).toBe('Red card');
    expect(redLabel('red')).toBe('Remove red card');
  });
});

describe('stepPoints', () => {
  it('moves whole points and stays between 0 and the limit', () => {
    expect(stepPoints(2.5, 1)).toBe(3.5);
    expect(stepPoints(3, -1)).toBe(2);
    expect(stepPoints(0, -1)).toBe(0);
    expect(stepPoints(30, 1)).toBe(30);
  });
});
