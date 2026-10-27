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

export const SPARE_BIB_COLOURS = [
  'red',
  'blue',
  'yellow',
  'green',
  'white',
  'orange',
  'purple',
  'pink',
] as const;

export type SpareBibColour = (typeof SPARE_BIB_COLOURS)[number];

export interface HeatBibEntryLike {
  id?: number;
  teamId: number;
  teamName?: string;
  laneIndex?: number;
  bibColour?: string | null;
  bibColourOverride?: string | null;
}

export interface HeatBibClash {
  colourKey: string;
  colourLabel: string;
  swatch: string;
  entries: HeatBibEntryLike[];
}

type TeamBibLookup =
  | ReadonlyMap<number, string | null | undefined>
  | Record<number, string | null | undefined>;

function lookupTeamBib(teamId: number, lookup?: TeamBibLookup): string | null | undefined {
  if (!lookup) return undefined;
  if (lookup instanceof Map || typeof (lookup as ReadonlyMap<number, string | null | undefined>).get === 'function') {
    return (lookup as ReadonlyMap<number, string | null | undefined>).get(teamId);
  }
  return (lookup as Record<number, string | null | undefined>)[teamId];
}

export function effectiveBibColour(
  entry: Pick<HeatBibEntryLike, 'bibColour' | 'bibColourOverride'>,
  fallbackTeamBibColour?: string | null,
): string | null {
  const override = entry.bibColourOverride?.trim();
  if (override) return override;
  const direct = entry.bibColour?.trim();
  if (direct) return direct;
  const fallback = fallbackTeamBibColour?.trim();
  return fallback || null;
}

export function normaliseBibColourKey(raw: string | null | undefined): string | null {
  const stripped = parseBibAndFlag(raw).bib;
  if (!stripped) return null;
  let collapsed = stripped.replace(/\s+/g, ' ').trim().toLowerCase();
  if (collapsed.endsWith(' bibs')) {
    collapsed = collapsed.slice(0, -5).trimEnd();
  } else if (collapsed.endsWith(' bib')) {
    collapsed = collapsed.slice(0, -4).trimEnd();
  }
  collapsed = collapsed.replace(/\bgray\b/g, 'grey');
  return collapsed || null;
}

function orderEntries(entries: readonly HeatBibEntryLike[]): HeatBibEntryLike[] {
  return [...entries].sort(
    (a, b) => (a.laneIndex ?? 0) - (b.laneIndex ?? 0) || (a.id ?? 0) - (b.id ?? 0) || a.teamId - b.teamId,
  );
}

export function detectHeatBibClashes(
  entries: readonly HeatBibEntryLike[],
  teamBibByTeamId?: TeamBibLookup,
): HeatBibClash[] {
  const ordered = orderEntries(entries);
  const groups = new Map<string, HeatBibEntryLike[]>();

  for (const entry of ordered) {
    const effective = effectiveBibColour(entry, lookupTeamBib(entry.teamId, teamBibByTeamId));
    const key = normaliseBibColourKey(effective);
    if (!key) continue;
    const list = groups.get(key);
    if (list) {
      list.push(entry);
    } else {
      groups.set(key, [entry]);
    }
  }

  const clashes: HeatBibClash[] = [];
  for (const [colourKey, groupEntries] of groups.entries()) {
    if (groupEntries.length < 2) continue;
    const colourLabel = colourKey.charAt(0).toUpperCase() + colourKey.slice(1);
    clashes.push({
      colourKey,
      colourLabel,
      swatch: bibAccent(colourKey),
      entries: groupEntries,
    });
  }
  return clashes;
}

export function hasHeatBibClash(
  entries: readonly HeatBibEntryLike[],
  teamBibByTeamId?: TeamBibLookup,
): boolean {
  return detectHeatBibClashes(entries, teamBibByTeamId).length > 0;
}

export function suggestSpareBibOverrides(
  entries: readonly HeatBibEntryLike[],
  teamBibByTeamId?: TeamBibLookup,
): Record<number, string | null> {
  const ordered = orderEntries(entries);
  interface Item {
    entry: HeatBibEntryLike;
    effectiveKey: string;
    baseKey: string | null;
  }

  const groups = new Map<string, Item[]>();
  for (const entry of ordered) {
    const baseRaw = lookupTeamBib(entry.teamId, teamBibByTeamId) ?? entry.bibColour;
    const baseKey = normaliseBibColourKey(baseRaw);
    const effectiveRaw = effectiveBibColour(entry, baseRaw);
    const effectiveKey = normaliseBibColourKey(effectiveRaw);
    if (!effectiveKey) continue;
    const item: Item = { entry, effectiveKey, baseKey };
    const list = groups.get(effectiveKey);
    if (list) {
      list.push(item);
    } else {
      groups.set(effectiveKey, [item]);
    }
  }

  const usedColours = new Set<string>(groups.keys());
  const updates: Record<number, string | null> = {};

  for (const groupItems of groups.values()) {
    if (groupItems.length < 2) continue;
    const prioritised = [...groupItems].sort((a, b) => {
      const aHasOverride = a.entry.bibColourOverride?.trim() ? 1 : 0;
      const bHasOverride = b.entry.bibColourOverride?.trim() ? 1 : 0;
      return (
        aHasOverride - bHasOverride ||
        (a.entry.laneIndex ?? 0) - (b.entry.laneIndex ?? 0) ||
        (a.entry.id ?? 0) - (b.entry.id ?? 0) ||
        a.entry.teamId - b.entry.teamId
      );
    });

    for (const item of prioritised.slice(1)) {
      let chosen: string | undefined;
      if (item.baseKey && !usedColours.has(item.baseKey)) {
        chosen = item.baseKey;
      } else {
        chosen = SPARE_BIB_COLOURS.find(c => !usedColours.has(c));
      }
      if (!chosen) continue;
      usedColours.add(chosen);
      const nextOverride = chosen === item.baseKey ? null : chosen;
      const currentOverride = item.entry.bibColourOverride?.trim() || null;
      if (currentOverride !== nextOverride) {
        updates[item.entry.teamId] = nextOverride;
      }
    }
  }

  return updates;
}
