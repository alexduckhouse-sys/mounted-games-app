import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INSTANT_LENGTHS, lengthLabel, loadInstantLength, saveInstantLength } from './instantReplay';

describe('instant replay length', () => {
  beforeEach(() => localStorage.clear());

  it('is 30 seconds until changed, then remembered', () => {
    expect(loadInstantLength()).toBe(30);
    saveInstantLength(60);
    expect(loadInstantLength()).toBe(60);
    expect(INSTANT_LENGTHS).toEqual([30, 60]);
  });

  it('ignores a value that is not one of the choices', () => {
    localStorage.setItem('mg.instantReplaySeconds', '45');
    expect(loadInstantLength()).toBe(30);
  });

  it('copes with blocked storage', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(loadInstantLength()).toBe(30);
    expect(() => saveInstantLength(60)).not.toThrow();
    get.mockRestore(); set.mockRestore();
  });

  it('writes lengths for buttons', () => {
    expect(lengthLabel(30)).toBe('30s');
    expect(lengthLabel(60)).toBe('1 min');
    expect(lengthLabel(90)).toBe('90s');
  });
});
