import type { CSSProperties } from 'react';
import { bibAccent } from './bib';

export interface TeamColour { name: string; rgb: string }

const c = (name: string, rgb: string): [string, TeamColour] => [name, { name, rgb }];

/** Colour words teams type, and what they mean. Synonyms point at the same colour. */
const WORDS: Record<string, TeamColour> = Object.fromEntries([
  c('red', '#dc2626'), c('scarlet', '#dc2626'), c('crimson', '#be123c'),
  c('maroon', '#7f1d1d'), c('burgundy', '#7f1d1d'), c('wine', '#7f1d1d'),
  c('pink', '#ec4899'), c('magenta', '#d946ef'), c('fuchsia', '#d946ef'), c('cerise', '#db2777'),
  c('orange', '#f97316'), c('amber', '#f59e0b'),
  c('yellow', '#facc15'), c('gold', '#eab308'), c('mustard', '#ca8a04'),
  c('green', '#16a34a'), c('emerald', '#10b981'), c('lime', '#84cc16'), c('olive', '#65a30d'), c('bottle', '#166534'), c('forest', '#166534'),
  c('teal', '#14b8a6'), c('turquoise', '#06b6d4'), c('aqua', '#06b6d4'), c('cyan', '#06b6d4'),
  c('blue', '#2563eb'), c('navy', '#1e3a8a'), c('royal', '#1d4ed8'), c('sky', '#0ea5e9'), c('cobalt', '#1d4ed8'),
  c('purple', '#9333ea'), c('violet', '#7c3aed'), c('lilac', '#a78bfa'), c('lavender', '#a78bfa'), c('plum', '#7e22ce'),
  c('brown', '#78350f'), c('chocolate', '#78350f'), c('tan', '#a16207'),
  c('white', '#f8fafc'), c('cream', '#fef3c7'),
  c('black', '#1f2937'),
  c('grey', '#94a3b8'), c('gray', '#94a3b8'), c('silver', '#cbd5e1'),
]);

/** Shades of a colour named on their own: "royal blue" is one colour, not royal and blue. */
const SHADE_OF: Record<string, string> = { royal: 'blue', sky: 'blue', cobalt: 'blue', navy: 'blue', bottle: 'green', forest: 'green', lime: 'green', emerald: 'green', olive: 'green' };

/** Words that change the shade of the next colour rather than naming one ("light blue", "dark green"). */
const SHADES: Record<string, string> = { light: 'light', pale: 'light', dark: 'dark', deep: 'dark' };

function shade(colour: TeamColour, how: string): TeamColour {
  const mix = how === 'light' ? 'white' : 'black';
  return { name: `${how} ${colour.name}`, rgb: `color-mix(in srgb, ${colour.rgb} 65%, ${mix})` };
}

/**
 * Up to two colours from what a team typed: "red", "navy", "white with red spots", "green/gold", "Light blue and white".
 * Colours are returned in the order written, without repeats. Text with no colour word gives none.
 */
export function parseTeamColours(text: string | null | undefined): TeamColour[] {
  const found: TeamColour[] = [];
  let pending: string | null = null;
  for (const word of (text ?? '').toLowerCase().split(/[^a-z]+/).filter(Boolean)) {
    if (SHADES[word]) { pending = SHADES[word]; continue; }
    const colour = WORDS[word];
    if (!colour) { pending = null; continue; }
    const last = found[found.length - 1];
    if (last && SHADE_OF[last.name] === word) { pending = null; continue; }
    const used = pending ? shade(colour, pending) : colour;
    pending = null;
    if (!found.some((f) => f.name === used.name)) found.push(used);
    if (found.length === 2) break;
  }
  return found;
}

/** A colour for a small dot: the first colour found, else the old guess from the text. */
export function dotColour(text: string | null | undefined): string {
  return parseTeamColours(text)[0]?.rgb ?? bibAccent(text);
}

/**
 * How to paint a team's scoring box. The fill is a light wash of the colour over the page surface, so the text
 * colour (the theme's ink) stays readable on every theme, and a solid edge carries the colour itself. Two colours
 * split the box in half. Text we can't read as a colour keeps a plain coloured left edge.
 */
export function teamBoxStyle(text: string | null | undefined): CSSProperties {
  const colours = parseTeamColours(text);
  const wash = (rgb: string) => `color-mix(in srgb, ${rgb} 20%, rgb(var(--mg-surface)))`;
  if (colours.length === 0) return text?.trim() ? { borderLeft: `6px solid ${bibAccent(text)}` } : {};
  if (colours.length === 1) return { background: wash(colours[0].rgb), boxShadow: `inset 6px 0 0 ${colours[0].rgb}` };
  const [a, b] = colours;
  return {
    background: `linear-gradient(90deg, ${wash(a.rgb)} 0 50%, ${wash(b.rgb)} 50% 100%)`,
    boxShadow: `inset 6px 0 0 ${a.rgb}, inset -6px 0 0 ${b.rgb}`,
  };
}
