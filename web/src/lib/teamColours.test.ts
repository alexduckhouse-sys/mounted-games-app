import { describe, expect, it } from 'vitest';
import { dotColour, parseTeamColours, teamBoxStyle } from './teamColours';

const names = (text: string | null | undefined) => parseTeamColours(text).map((c) => c.name);

describe('parseTeamColours', () => {
  it('reads one colour, whatever the case', () => {
    expect(names('red')).toEqual(['red']);
    expect(names('  Navy ')).toEqual(['navy']);
    expect(names('Burgundy')).toEqual(['burgundy']);
  });

  it('reads two colours from the usual ways of writing them', () => {
    expect(names('white with red spots')).toEqual(['white', 'red']);
    expect(names('green/gold')).toEqual(['green', 'gold']);
    expect(names('Red & White')).toEqual(['red', 'white']);
    expect(names('black, yellow and purple')).toEqual(['black', 'yellow']);
  });

  it('keeps royal blue, sky blue and bottle green as one colour', () => {
    expect(names('royal blue')).toEqual(['royal']);
    expect(names('Sky blue and white')).toEqual(['sky', 'white']);
    expect(names('bottle green / gold')).toEqual(['bottle', 'gold']);
  });

  it('shades light and dark colours', () => {
    expect(names('light blue')).toEqual(['light blue']);
    expect(parseTeamColours('dark green')[0].rgb).toContain('black');
    expect(parseTeamColours('pale pink')[0].rgb).toContain('white');
  });

  it('does not repeat a colour, and gives none for text with no colour', () => {
    expect(names('red red')).toEqual(['red']);
    expect(names('stripey with spots')).toEqual([]);
    expect(names('')).toEqual([]);
    expect(names(null)).toEqual([]);
    expect(names('hot pink')).toEqual(['pink']);
  });
});

describe('teamBoxStyle', () => {
  it('washes the box in one colour with a solid edge', () => {
    const style = teamBoxStyle('red');
    expect(String(style.background)).toContain('#dc2626');
    expect(String(style.background)).toContain('20%');
    expect(String(style.boxShadow)).toContain('inset 6px 0 0 #dc2626');
  });

  it('splits the box in half for two colours', () => {
    const style = teamBoxStyle('red/white');
    expect(String(style.background)).toMatch(/linear-gradient\(90deg, .* 0 50%, .* 50% 100%\)/);
    expect(String(style.boxShadow)).toContain('#dc2626');
    expect(String(style.boxShadow)).toContain('#f8fafc');
  });

  it('falls back to a coloured left edge for text it cannot read, and nothing when empty', () => {
    expect(teamBoxStyle('spotty')).toEqual({ borderLeft: expect.stringMatching(/^6px solid #/) });
    expect(teamBoxStyle('')).toEqual({});
    expect(teamBoxStyle(null)).toEqual({});
  });
});

describe('dotColour', () => {
  it('uses the first parsed colour, else the old guess', () => {
    expect(dotColour('white with red spots')).toBe('#f8fafc');
    expect(dotColour('spotty')).toMatch(/^#/);
  });
});
