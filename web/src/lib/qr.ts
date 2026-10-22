import { encode } from 'uqr';

export interface QrShape {
  /** Modules along one side, not counting the quiet zone. */
  size: number;
  /** SVG path data: one rectangle per horizontal run of dark modules. */
  path: string;
}

/**
 * Lays out a QR code for `text` as SVG path data, or returns null when the text is too long to fit.
 * The code is made in the browser, so what it points at (a team's join key, say) never goes to a
 * third-party service. Medium error correction survives a creased or smudged poster.
 */
export function qrShape(text: string): QrShape | null {
  if (!text) return null;
  let rows: boolean[][];
  try {
    rows = encode(text, { ecc: 'M', border: 0 }).data;
  } catch {
    return null;
  }
  let path = '';
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) { x += 1; continue; }
      const start = x;
      while (x < row.length && row[x]) x += 1;
      path += `M${start} ${y}h${x - start}v1h${start - x}z`;
    }
  });
  return { size: rows.length, path };
}

/** Modules of white space to leave round a code so scanners can find its edges. */
export const QR_QUIET_ZONE = 4;
