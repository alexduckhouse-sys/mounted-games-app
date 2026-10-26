import { describe, expect, it } from 'vitest';
import { bankDetailsText } from './bankDetails';

describe('bankDetailsText', () => {
  it('lists pay to, reference and amount on separate lines', () => {
    expect(bankDetailsText({ payTo: 'Sort code 00-00-00\nAccount 12345678', reference: 'Oak A', amount: '£32' }))
      .toBe('Pay to: Sort code 00-00-00\nAccount 12345678\nReference: Oak A\nAmount: £32');
  });

  it('leaves out Pay to when the organiser has not given one', () => {
    expect(bankDetailsText({ payTo: null, reference: 'Oak A', amount: '£32' })).toBe('Reference: Oak A\nAmount: £32');
  });
});
