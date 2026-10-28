import { describe, expect, it } from 'vitest';
import { HATBAND_PALETTE, formatHatband, hatbandBoxStyle, hatbandColour, hatbandHex, hatbandName, isHatbandHex, localHatbandName, parseHatband } from './hatbands';
import { translate } from '../i18n/translate';

describe('parseHatband', () => {
  it('reads a fixed colour as just a name', () => {
    expect(parseHatband('Red')).toEqual({ name: 'Red', hex: null });
    expect(parseHatband('  Dark green ')).toEqual({ name: 'Dark green', hex: null });
  });

  it('splits "Name #RRGGBB" into its name and its colour, in capitals', () => {
    expect(parseHatband('Lilac #b79ced')).toEqual({ name: 'Lilac', hex: '#B79CED' });
    expect(parseHatband('Sea  Green #00AA55')).toEqual({ name: 'Sea  Green', hex: '#00AA55' });
  });

  it('copes with a colour on its own and with nothing', () => {
    expect(parseHatband('#123456')).toEqual({ name: '', hex: '#123456' });
    expect(parseHatband(null)).toEqual({ name: '', hex: null });
    expect(parseHatband(undefined)).toEqual({ name: '', hex: null });
  });

  it('does not take a short or misplaced hash for a colour', () => {
    expect(parseHatband('Team #1')).toEqual({ name: 'Team #1', hex: null });
    expect(parseHatband('#AABBCC stripes')).toEqual({ name: '#AABBCC stripes', hex: null });
    expect(parseHatband('Red #12345G')).toEqual({ name: 'Red #12345G', hex: null });
  });
});

describe('formatHatband', () => {
  it('stores a name with its own colour as "Name #RRGGBB"', () => {
    expect(formatHatband('  Lilac ', '#b79ced')).toBe('Lilac #B79CED');
    expect(formatHatband('Sea   green', '#00aa55')).toBe('Sea green #00AA55');
  });

  it('stores a fixed colour as its plain name when the colour is the list’s own', () => {
    expect(formatHatband('red', '#c8202f')).toBe('Red');
    expect(formatHatband('Red', '#C8202F')).toBe('Red');
  });

  it('keeps a fixed colour’s name with a different colour as a custom one', () => {
    expect(formatHatband('Red', '#FF0000')).toBe('Red #FF0000');
  });

  it('stores a name alone, ignores an invalid colour, and a colour alone', () => {
    expect(formatHatband('Navy')).toBe('Navy');
    expect(formatHatband('Navy', null)).toBe('Navy');
    expect(formatHatband('Navy', '#12')).toBe('Navy');
    expect(formatHatband('', '#123456')).toBe('#123456');
  });

  it('round-trips through parseHatband', () => {
    const stored = formatHatband('Lilac', '#B79CED');
    expect(parseHatband(stored)).toEqual({ name: 'Lilac', hex: '#B79CED' });
  });
});

describe('localHatbandName', () => {
  it('translates the fixed colours and the custom label, and leaves typed names alone', () => {
    const cy = (key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) => translate('cy', key, values);
    expect(localHatbandName('Red', cy)).toBe('Coch');
    expect(localHatbandName('pink', cy)).toBe('Pinc');
    expect(localHatbandName('#B79CED', cy)).toBe('Lliw personol');
    expect(localHatbandName('Lilac #B79CED', cy)).toBe('Lilac');
    expect(localHatbandName('', cy)).toBe('');
    expect(localHatbandName(null, cy)).toBe('');
  });
});

describe('hatbandName', () => {
  it('never shows the hex', () => {
    expect(hatbandName('Lilac #B79CED')).toBe('Lilac');
    expect(hatbandName('Red')).toBe('Red');
    expect(hatbandName('#B79CED')).toBe('Custom colour');
    expect(hatbandName('')).toBe('');
    expect(hatbandName(null)).toBe('');
  });
});

describe('hatbandColour', () => {
  it('uses its own colour first', () => {
    expect(hatbandColour('Red #112233')).toBe('#112233');
  });

  it('falls back to the fixed list, ignoring case', () => {
    expect(hatbandColour('Blue')).toBe(HATBAND_PALETTE.Blue);
    expect(hatbandColour(' yellow ')).toBe(HATBAND_PALETTE.Yellow);
  });

  it('then guesses from the colour word, and has a grey for nothing it knows', () => {
    expect(hatbandColour('Navy')).toBe('#1e3a8a');
    expect(hatbandColour('Spots')).toMatch(/^#|rgb|hsl/);
  });
});

describe('hatbandHex', () => {
  it('gives a colour-picker value for every kind of hatband', () => {
    expect(hatbandHex('Lilac #B79CED')).toBe('#B79CED');
    expect(hatbandHex('Green')).toBe('#2E8B57');
    expect(hatbandHex('Navy')).toBe('#1e3a8a');
    expect(hatbandHex('Light blue')).toBe('#8A93A0');
  });
});

describe('hatbandBoxStyle', () => {
  it('paints a wash and an edge from its own colour', () => {
    const style = hatbandBoxStyle('Lilac #B79CED');
    expect(String(style.background)).toContain('#B79CED');
    expect(String(style.boxShadow)).toContain('#B79CED');
  });

  it('uses the team colour rules for a colour word, and nothing for nothing', () => {
    expect(String(hatbandBoxStyle('Red').boxShadow)).toContain('#dc2626');
    expect(hatbandBoxStyle('')).toEqual({});
  });
});

describe('isHatbandHex', () => {
  it('accepts exactly #RRGGBB', () => {
    expect(isHatbandHex('#a1B2c3')).toBe(true);
    expect(isHatbandHex('#a1b2c')).toBe(false);
    expect(isHatbandHex('a1b2c3')).toBe(false);
  });
});
