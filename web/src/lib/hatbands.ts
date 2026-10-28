import type { CSSProperties } from 'react';
import type { MessageKey } from '../i18n/en';
import type { Translate } from '../i18n/translate';
import { dotColour, teamBoxStyle } from './teamColours';

/**
 * A hatband is stored in the API as one plain string. A colour from the fixed list is just its name ("Red").
 * A colour of your own is "Name #RRGGBB" ("Lilac #B79CED"). Everything that shows a hatband goes through this
 * file, so the "#RRGGBB" part never reaches the screen.
 */

/** The fixed list: each name and the colour it paints. */
export const HATBAND_PALETTE: Readonly<Record<string, string>> = {
  Red: '#C8202F', White: '#FFFFFF', Blue: '#2B5FA8', Yellow: '#E8B400', Green: '#2E8B57', Black: '#222222', Orange: '#E87B00', Pink: '#E86AA6',
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const STORED = /^(.*?)\s*(#[0-9a-fA-F]{6})$/;

export const isHatbandHex = (value: string): boolean => HEX.test(value);

export interface Hatband { name: string; hex: string | null }

/** Splits a stored hatband into its name and its own colour (null when it uses the fixed list or a colour word). */
export function parseHatband(stored: string | null | undefined): Hatband {
  const text = (stored ?? '').trim();
  const match = STORED.exec(text);
  return match ? { name: match[1].trim(), hex: match[2].toUpperCase() } : { name: text, hex: null };
}

/** The string to store. A colour that is just the fixed list's own colour for that name is stored as the plain name. */
export function formatHatband(name: string, hex?: string | null): string {
  const clean = name.trim().replace(/\s+/g, ' ');
  const colour = hex && HEX.test(hex) ? hex.toUpperCase() : null;
  if (!colour) return clean;
  const fixed = Object.entries(HATBAND_PALETTE).find(([key]) => key.toLowerCase() === clean.toLowerCase());
  if (fixed && fixed[1].toUpperCase() === colour) return fixed[0];
  return clean ? `${clean} ${colour}` : colour;
}

/** What to call a hatband out loud: its name, never the hex. */
export function hatbandName(stored: string | null | undefined): string {
  const { name, hex } = parseHatband(stored);
  return name || (hex ? 'Custom colour' : '');
}

const COLOUR_KEYS: Readonly<Record<string, MessageKey>> = {
  red: 'screen.colour.red', white: 'screen.colour.white', blue: 'screen.colour.blue', yellow: 'screen.colour.yellow',
  green: 'screen.colour.green', black: 'screen.colour.black', orange: 'screen.colour.orange', pink: 'screen.colour.pink',
};

/** `hatbandName` in the reader's language: the fixed list's colour names and "Custom colour" are translated, a name an organiser typed is left alone. */
export function localHatbandName(stored: string | null | undefined, t: Translate): string {
  const { name, hex } = parseHatband(stored);
  if (!name) return hex ? t('screen.colour.custom') : '';
  const key = COLOUR_KEYS[name.toLowerCase()];
  return key ? t(key) : name;
}

/** The colour to paint for a hatband: its own colour, else the fixed list, else a guess from the colour word. */
export function hatbandColour(stored: string | null | undefined): string {
  const { name, hex } = parseHatband(stored);
  if (hex) return hex;
  const fixed = Object.entries(HATBAND_PALETTE).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return fixed ? fixed[1] : dotColour(name);
}

/** The colour as the `#rrggbb` a colour picker wants. Colours that are not a hex fall back to the list or a neutral grey. */
export function hatbandHex(stored: string | null | undefined): string {
  const colour = hatbandColour(stored);
  return HEX.test(colour) ? colour : '#8A93A0';
}

/** A scoring box painted for a hatband: a light wash with a solid edge, like the bib colours. */
export function hatbandBoxStyle(stored: string | null | undefined): CSSProperties {
  const { name, hex } = parseHatband(stored);
  if (!hex) return teamBoxStyle(name);
  return { background: `color-mix(in srgb, ${hex} 20%, rgb(var(--mg-surface)))`, boxShadow: `inset 6px 0 0 ${hex}` };
}
