import type { StatsHit } from '../../types';

/** One rider as the browse list shows them: "Barker, Arthur", under B. */
export interface RiderLine {
  hit: StatsHit;
  /** The surname, or the whole name when a rider is shown by surname initial or has one name only. */
  surname: string;
  /** The first names, shown after the comma; empty when `surname` is the whole name. */
  given: string;
  /** True for "Catriona E.": the rider asked to be shown by surname initial, so the name stays as it is. */
  initialOnly: boolean;
  /** What the list sorts on, lower case. */
  sortKey: string;
  /** The A–Z heading it sits under. */
  letter: string;
}

export interface RiderGroup { letter: string; riders: RiderLine[] }

/** Words that belong to the surname when they come just before it: "van der Berg", "de la Cruz". */
const PARTICLE = /^[a-zà-ÿ'’]+$/u;

/** The surname is the last word, as the API shortens it (`RiderNames.ShortenSurname`), plus any lower-case words in front of it. */
export function riderLine(hit: StatsHit): RiderLine {
  const words = hit.name.trim().split(/\s+/).filter(Boolean);
  const last = words[words.length - 1] ?? '';
  const initialOnly = words.length > 1 && /^\p{L}\.$/u.test(last);
  if (initialOnly || words.length < 2) {
    const name = words.join(' ');
    return { hit, surname: name, given: '', initialOnly, sortKey: name.toLowerCase(), letter: letterOf(name) };
  }
  let start = words.length - 1;
  while (start > 1 && PARTICLE.test(words[start - 1])) start -= 1;
  const surname = words.slice(start).join(' ');
  const given = words.slice(0, start).join(' ');
  return { hit, surname, given, initialOnly: false, sortKey: `${surname} ${given}`.toLowerCase(), letter: letterOf(surname) };
}

function letterOf(text: string): string {
  const first = text.trim().charAt(0).normalize('NFD').charAt(0).toUpperCase();
  return /^[A-Z]$/.test(first) ? first : '#';
}

/** Riders sorted surname first (a rider shown by initial sorts by first name) and grouped under A–Z headings; anything else goes last under #. */
export function groupRiders(hits: StatsHit[]): RiderGroup[] {
  const lines = hits.map(riderLine).sort((a, b) => a.sortKey.localeCompare(b.sortKey, 'en-GB', { sensitivity: 'base' }) || a.hit.key.localeCompare(b.hit.key));
  const groups: RiderGroup[] = [];
  for (const line of lines) {
    const group = groups.find((entry) => entry.letter === line.letter);
    if (group) group.riders.push(line); else groups.push({ letter: line.letter, riders: [line] });
  }
  return groups.sort((a, b) => (a.letter === '#' ? 1 : b.letter === '#' ? -1 : a.letter.localeCompare(b.letter)));
}
