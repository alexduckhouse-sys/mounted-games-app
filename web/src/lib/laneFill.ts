import { parseTeamColours } from './teamColours';

/** A lane box painted with its bib colour: the colour and the text colours that stay readable on it. */
export interface LaneFill { colour: string; ink: string; inkSoft: string; dark: boolean }

const DARK_INK = '#111827';
const LIGHT_INK = '#FFFFFF';

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Reads the colours teamColours.ts produces: a hex, or `color-mix(in srgb, #hex N%, white|black)` for "light blue". */
export function colourToRgb(colour: string): Rgb | null {
  const mix = /^color-mix\(in srgb,\s*(#[0-9a-f]{6})\s+(\d+)%,\s*(white|black)\)$/i.exec(colour.trim());
  if (!mix) return hexToRgb(colour);
  const base = hexToRgb(mix[1]);
  if (!base) return null;
  const share = Number(mix[2]) / 100;
  const other = mix[3].toLowerCase() === 'white' ? 255 : 0;
  return base.map((c) => Math.round(c * share + other * (1 - share))) as Rgb;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** Dark or light text for a background, whichever has the higher contrast ratio. */
export function inkFor(rgb: Rgb): { ink: string; dark: boolean } {
  const lum = luminance(rgb);
  const onDark = contrast(lum, luminance(hexToRgb(DARK_INK)!));
  const onLight = contrast(lum, luminance(hexToRgb(LIGHT_INK)!));
  return onDark >= onLight ? { ink: DARK_INK, dark: true } : { ink: LIGHT_INK, dark: false };
}

/**
 * The fill for a lane's whole box from what the team typed as its bib ("Red", "light blue", "green/gold"). The first
 * colour is used. Text with no colour word gives null, so the box keeps its normal look rather than a guessed colour.
 */
export function laneFill(bib: string | null | undefined): LaneFill | null {
  const first = parseTeamColours(bib)[0];
  const rgb = first ? colourToRgb(first.rgb) : null;
  if (!first || !rgb) return null;
  const { ink, dark } = inkFor(rgb);
  return { colour: first.rgb, ink, inkSoft: dark ? 'rgb(17 24 39 / .72)' : 'rgb(255 255 255 / .85)', dark };
}
