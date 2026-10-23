import { describe, expect, it } from 'vitest';
import { RESULT_STATUS, STATUS_CHOICES, effectiveStatus, statusLabel, statusLetter } from './resultStatus';

describe('effectiveStatus', () => {
  it('is Finished for a team that finished, whatever status came with it', () => {
    expect(effectiveStatus(false)).toBe(RESULT_STATUS.Finished);
    expect(effectiveStatus(false, 3)).toBe(RESULT_STATUS.Finished);
  });

  it('reads a team that did not finish and has no status as eliminated, as old data was', () => {
    expect(effectiveStatus(true)).toBe(RESULT_STATUS.Eliminated);
    expect(effectiveStatus(true, null)).toBe(RESULT_STATUS.Eliminated);
    expect(effectiveStatus(true, 0)).toBe(RESULT_STATUS.Eliminated);
    expect(effectiveStatus(true, 99)).toBe(RESULT_STATUS.Eliminated);
  });

  it('keeps a known reason', () => {
    expect(effectiveStatus(true, 2)).toBe(RESULT_STATUS.DidNotStart);
    expect(effectiveStatus(true, 4)).toBe(RESULT_STATUS.Retired);
  });
});

describe('statusLetter and statusLabel', () => {
  it('gives the letters scorers and sheets use', () => {
    expect(STATUS_CHOICES.map((c) => statusLetter(true, c.value))).toEqual(['E', 'DNS', 'DNF', 'R']);
    expect(statusLetter(true)).toBe('E');
  });

  it('gives words for screen readers', () => {
    expect(statusLabel(true, 3)).toBe('Did not finish');
    expect(statusLabel(true)).toBe('Eliminated');
  });

  it('has nothing to say about a finisher', () => {
    expect(statusLetter(false)).toBeNull();
    expect(statusLabel(false, 2)).toBeNull();
  });
});
