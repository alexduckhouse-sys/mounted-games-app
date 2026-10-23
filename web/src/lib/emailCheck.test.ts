import { describe, expect, it } from 'vitest';
import { editDistance, isRealisticEmail, suggestEmailFix } from './emailCheck';

describe('isRealisticEmail', () => {
  it.each([
    'sam@gmail.com', '  Sam.Lee+club@Sub.Example.co.uk ', "o'brien@example.ie", 'a@b.co', 'sam@xn--bcher-kva.example',
  ])('accepts %j', (v) => expect(isRealisticEmail(v)).toBe(true));

  it.each([
    '', 'sam', 'sam@', '@gmail.com', 'sam@gmail', 'sam@@gmail.com', 'sam..lee@gmail.com', '.sam@gmail.com', 'sam.@gmail.com',
    'sam lee@gmail.com', 'sam@-gmail.com', 'sam@gmail-.com', 'sam@gmail.c', 'sam@gmail.123', 'sam@exa_mple.com', 'sam@example..com',
    `${'a'.repeat(65)}@gmail.com`, `a@${'b'.repeat(250)}.com`,
  ])('rejects %j', (v) => expect(isRealisticEmail(v)).toBe(false));
});

describe('editDistance', () => {
  it('counts a swap of neighbours as one change', () => {
    expect(editDistance('gmial', 'gmail')).toBe(1);
    expect(editDistance('abc', 'abc')).toBe(0);
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });
});

describe('suggestEmailFix', () => {
  it.each([
    ['sam@gmial.com', 'sam@gmail.com'],
    ['sam@gmal.com', 'sam@gmail.com'],
    ['sam@gmail.con', 'sam@gmail.com'],
    ['sam@gmail.co', 'sam@gmail.com'],
    ['sam@hotmial.com', 'sam@hotmail.com'],
    ['sam@hotmal.co.uk', 'sam@hotmail.co.uk'],
    ['sam@outlok.com', 'sam@outlook.com'],
    ['sam@yaho.com', 'sam@yahoo.com'],
    ['Sam@Gmial.Com', 'sam@gmail.com'],
    ['sam@icloud.cm', 'sam@icloud.com'],
    ['sam@btinternt.com', 'sam@btinternet.com'],
  ])('suggests a fix for %s', (input, fix) => expect(suggestEmailFix(input)).toBe(fix));

  it.each([
    'sam@gmail.com', 'sam@hotmail.co.uk', 'sam@mypony.club', 'sam@stockportpc.org.uk', 'sam@example.com', 'sam@co.uk',
    'sam@', 'sam', '@gmial.com', '',
  ])('leaves %j alone', (input) => expect(suggestEmailFix(input)).toBeNull());
});
