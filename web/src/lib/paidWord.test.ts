import { describe, expect, it } from 'vitest';
import { paidWord } from './paidWord';

describe('paidWord', () => {
  it('says Paid for a real payment', () => {
    expect(paidWord()).toBe('Paid');
    expect(paidWord(false)).toBe('Paid');
    expect(paidWord(null)).toBe('Paid');
  });

  it('says Demo paid for a demo payment', () => {
    expect(paidWord(true)).toBe('Demo paid');
  });
});
