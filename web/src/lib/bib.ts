const NAMED: Record<string, string> = {
  red: '#dc2626',
  crimson: '#be123c',
  rose: '#f43f5e',
  pink: '#ec4899',
  magenta: '#d946ef',
  orange: '#f97316',
  'burnt orange': '#c2410c',
  yellow: '#facc15',
  gold: '#eab308',
  mustard: '#b45309',
  green: '#16a34a',
  'forest green': '#059669',
  'dark green': '#15803d',
  'emerald green': '#10b981',
  'light green': '#22c55e',
  'lime green': '#84cc16',
  olive: '#65a30d',
  teal: '#14b8a6',
  cyan: '#06b6d4',
  sky: '#0ea5e9',
  'sky blue': '#0ea5e9',
  blue: '#2563eb',
  'royal blue': '#1d4ed8',
  navy: '#0284c7',
  purple: '#9333ea',
  violet: '#7c3aed',
  plum: '#9333ea',
  white: '#f8fafc',
  black: '#1f2937',
  brown: '#78350f',
  grey: '#94a3b8',
  gray: '#94a3b8',
};

const PALETTE = [
  '#16a34a', '#dc2626', '#2563eb', '#f59e0b', '#8b5cf6',
  '#0ea5e9', '#10b981', '#ef4444', '#f97316', '#84cc16',
  '#06b6d4', '#a855f7', '#22c55e', '#eab308', '#3b82f6',
  '#ec4899', '#14b8a6', '#f43f5e',
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const FLAG_TAG = /^\[flag:([a-z0-9-]+)\]\s*(.*)$/i;

export function parseBibAndFlag(text: string | null | undefined): { bib: string; flag: string | null } {
  const trimmed = text?.trim() ?? '';
  if (!trimmed) return { bib: '', flag: null };
  const match = FLAG_TAG.exec(trimmed);
  if (!match) return { bib: trimmed, flag: null };
  return { bib: match[2].trim(), flag: match[1].toLowerCase() };
}

export function formatBibWithFlag(bib: string, flag: string | null | undefined): string {
  const cleanBib = parseBibAndFlag(bib).bib;
  const cleanFlag = flag?.trim().toLowerCase() ?? '';
  if (!cleanFlag) return cleanBib;
  return cleanBib ? `[flag:${cleanFlag}] ${cleanBib}` : `[flag:${cleanFlag}]`;
}

export function bibAccent(text: string | null | undefined): string {
  const lower = parseBibAndFlag(text).bib.toLowerCase();
  if (!lower) return '#94a3b8';
  if (NAMED[lower]) return NAMED[lower];
  // try first word match (e.g. "Red with white spots" → red)
  for (const word of lower.split(/[\s,/]+/)) {
    if (NAMED[word]) return NAMED[word];
  }
  return PALETTE[hashStr(lower) % PALETTE.length];
}

export function bibLabel(text: string | null | undefined): string {
  return parseBibAndFlag(text).bib || 'No bib set';
}
