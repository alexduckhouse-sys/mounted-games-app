import { describe, expect, it } from 'vitest';
import {
  allOptionsSoldOut, basketKey, hasOptions, isSoldOut, lineTitle, listingTotal, MAX_OPTION_LABEL, MAX_OPTIONS, maxQuantity, optionInputsFrom,
  optionsBody, optionsFromText, optionsOf, optionsProblem, orderLines, parseBasketKey, quantityIn, setQuantity, upgradeBasket,
  type ListingWithOptions,
} from './shopOptions';

const hoodie: ListingWithOptions = {
  id: 7,
  stockQuantity: 5,
  options: [
    { id: 70, label: 'S', stockQuantity: 0 },
    { id: 71, label: 'M', stockQuantity: 3 },
    { id: 72, label: 'L', stockQuantity: null },
  ],
};
const programme: ListingWithOptions = { id: 3, stockQuantity: null };

describe('optionsOf', () => {
  it('returns only what the seller set up, never a guess from the title', () => {
    // A listing called "Club hoodie" with no options has no sizes: no XS–XXL pills appear from its name.
    const titledLikeClothing = { id: 9, stockQuantity: null, title: 'Club hoodie', description: 'Fleece jacket', options: [] };
    expect(optionsOf(titledLikeClothing)).toEqual([]);
    expect(hasOptions(titledLikeClothing)).toBe(false);
    expect(optionsOf({ options: null })).toEqual([]);
    expect(optionsOf({})).toEqual([]);
    expect(optionsOf(hoodie).map((o) => o.label)).toEqual(['S', 'M', 'L']);
    expect(hasOptions(hoodie)).toBe(true);
  });

  it('knows a sold-out option from one with no limit', () => {
    expect(isSoldOut({ stockQuantity: 0 })).toBe(true);
    expect(isSoldOut({ stockQuantity: 2 })).toBe(false);
    expect(isSoldOut({ stockQuantity: null })).toBe(false);
    expect(allOptionsSoldOut(hoodie)).toBe(false);
    expect(allOptionsSoldOut({ options: [{ id: 1, label: 'S', stockQuantity: 0 }] })).toBe(true);
    expect(allOptionsSoldOut(programme)).toBe(false);
  });
});

describe('basket keys', () => {
  it('round-trip a listing with and without an option', () => {
    expect(basketKey(7, 71)).toBe('7:71');
    expect(basketKey(3, null)).toBe('3:');
    expect(basketKey(3, undefined)).toBe('3:');
    expect(parseBasketKey('7:71')).toEqual({ listingId: 7, optionId: 71 });
    expect(parseBasketKey('3:')).toEqual({ listingId: 3, optionId: null });
    expect(parseBasketKey('nonsense')).toBeNull();
  });
});

describe('a basket per option', () => {
  it('keeps an M and an L of the same hoodie as two lines', () => {
    let basket = setQuantity({}, hoodie, 71, 2);
    basket = setQuantity(basket, hoodie, 72, 1);
    expect(basket).toEqual({ '7:71': 2, '7:72': 1 });
    expect(quantityIn(basket, 7, 71)).toBe(2);
    expect(quantityIn(basket, 7, 70)).toBe(0);
    expect(listingTotal(basket, 7)).toBe(3);
    expect(orderLines(basket)).toEqual([
      { listingId: 7, quantity: 2, optionId: 71 },
      { listingId: 7, quantity: 1, optionId: 72 },
    ]);
  });

  it('refuses a sold-out option and caps at the option’s and the item’s stock', () => {
    expect(setQuantity({}, hoodie, 70, 1)).toEqual({});
    expect(maxQuantity(hoodie, 70, {})).toBe(0);
    expect(setQuantity({}, hoodie, 71, 10)).toEqual({ '7:71': 3 });
    // L has no limit of its own, but the hoodie has 5 in all and the basket already holds 3 Ms.
    const withM = setQuantity({}, hoodie, 71, 3);
    expect(maxQuantity(hoodie, 72, withM)).toBe(2);
    expect(setQuantity(withM, hoodie, 72, 9)).toEqual({ '7:71': 3, '7:72': 2 });
    expect(maxQuantity(programme, null, {})).toBe(99);
    expect(maxQuantity(programme, null, { '3:': 98 })).toBe(99);
  });

  it('needs one of the item’s own options, and none for an item without', () => {
    expect(setQuantity({}, hoodie, null, 1)).toEqual({});
    expect(setQuantity({}, hoodie, 999, 1)).toEqual({});
    expect(maxQuantity(hoodie, 999, {})).toBe(0);
    expect(setQuantity({}, programme, 5, 1)).toEqual({});
    expect(setQuantity({}, programme, null, 2)).toEqual({ '3:': 2 });
  });

  it('removes a line at zero and ignores nonsense quantities', () => {
    const basket = setQuantity({}, programme, null, 2);
    expect(setQuantity(basket, programme, null, 0)).toEqual({});
    expect(setQuantity(basket, programme, null, Number.NaN)).toEqual({});
    expect(setQuantity(basket, programme, null, 2.7)).toEqual({ '3:': 2 });
  });

  it('builds order lines with the detail beside the option, never inside it', () => {
    const lines = orderLines({ '7:72': 1, '3:': 2, '7:71': 1, junk: 4, '9:': 0 }, { 3: '  B12 ', 7: '' });
    expect(lines).toEqual([
      { listingId: 3, quantity: 2, detail: 'B12' },
      { listingId: 7, quantity: 1, optionId: 71 },
      { listingId: 7, quantity: 1, optionId: 72 },
    ]);
    expect(lines.some((l) => /size/i.test(l.detail ?? ''))).toBe(false);
  });
});

describe('upgradeBasket', () => {
  it('keeps old lines for items without options and drops ones that now need a choice', () => {
    expect(upgradeBasket({ 3: 2, 7: 1, 99: 1, '7:71': 2, bad: 1, '3:': 'x', 4: -1 }, [hoodie, programme]))
      .toEqual({ '3:': 2, '7:71': 2 });
    expect(upgradeBasket(null, [hoodie])).toEqual({});
    expect(upgradeBasket('nope', [hoodie])).toEqual({});
  });
});

describe('lineTitle', () => {
  it('adds the option after the title', () => {
    expect(lineTitle({ title: 'Hoodie', optionLabel: ' M ' })).toBe('Hoodie · M');
    expect(lineTitle({ title: 'Programme', optionLabel: null })).toBe('Programme');
    expect(lineTitle({ title: 'Programme' })).toBe('Programme');
  });
});

describe('the seller’s option editor', () => {
  it('starts from the saved options, keeping their ids', () => {
    expect(optionInputsFrom(hoodie.options)).toEqual([
      { id: 70, label: 'S', stockQuantity: 0 },
      { id: 71, label: 'M', stockQuantity: 3 },
      { id: 72, label: 'L', stockQuantity: null },
    ]);
    expect(optionInputsFrom(null)).toEqual([]);
  });

  it('adds options from a typed list, skipping blanks and repeats', () => {
    expect(optionsFromText('XS, S,, m\nAge 9-10')).toEqual([
      { label: 'XS', stockQuantity: null },
      { label: 'S', stockQuantity: null },
      { label: 'm', stockQuantity: null },
      { label: 'Age 9-10', stockQuantity: null },
    ]);
    expect(optionsFromText('M, L', [{ id: 1, label: 'm', stockQuantity: 2 }])).toEqual([
      { id: 1, label: 'm', stockQuantity: 2 },
      { label: 'L', stockQuantity: null },
    ]);
  });

  it('checks the options the way the API does', () => {
    expect(optionsProblem([{ label: 'S', stockQuantity: 1 }, { label: 'M', stockQuantity: null }])).toBeNull();
    expect(optionsProblem([{ label: ' ', stockQuantity: null }])).toMatch(/needs a name/);
    expect(optionsProblem([{ label: 'x'.repeat(MAX_OPTION_LABEL + 1), stockQuantity: null }])).toMatch(/at most 40/);
    expect(optionsProblem([{ label: 'M', stockQuantity: -1 }])).toMatch(/Stock for M/);
    expect(optionsProblem([{ label: 'M', stockQuantity: 1.5 }])).toMatch(/whole number/);
    expect(optionsProblem([{ label: 'M', stockQuantity: null }, { label: ' m ', stockQuantity: null }])).toMatch(/listed twice/);
    expect(optionsProblem(Array.from({ length: MAX_OPTIONS + 1 }, (_, i) => ({ label: `S${i}`, stockQuantity: null })))).toMatch(/at most 30/);
  });

  it('sends trimmed labels and only the ids it has', () => {
    expect(optionsBody([{ id: 4, label: ' M ', stockQuantity: 2 }, { label: 'L', stockQuantity: null }, { id: null, label: 'XL', stockQuantity: 1 }]))
      .toEqual([{ id: 4, label: 'M', stockQuantity: 2 }, { label: 'L', stockQuantity: null }, { label: 'XL', stockQuantity: 1 }]);
  });
});
