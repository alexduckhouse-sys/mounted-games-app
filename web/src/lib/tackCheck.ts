import type { TackCheckMark, TackCheckMode, TackCheckSector } from '../types';

/** The sectors a section starts with, as the API's `TackCheckService.DefaultSectors`. */
export const DEFAULT_TACK_SECTORS = ['Saddle/Girth', 'Bridle/Bit', 'Rider Hat/Boots', 'Turnout'];
export const MAX_TACK_SECTORS = 12;
export const MAX_SECTOR_NAME = 60;

export const TACK_MODES: { mode: TackCheckMode; label: string; detail: string }[] = [
  { mode: 0, label: 'Pass or fail only', detail: 'A checklist for the stewards. Nothing is scored.' },
  { mode: 1, label: 'Tack & Turnout table', detail: 'Points for each sector, shown in their own table. The main standings stay as they are.' },
  { mode: 2, label: 'Bonus points', detail: 'Points for each sector are added to the team’s total in the main standings, shown as tack check bonus points.' },
];

/** True for the modes where stewards give points rather than a pass or fail. */
export const isScored = (mode: TackCheckMode) => mode !== 0;

/** What is wrong with this list of sector names, as the API checks it, or null when it can be saved. */
export function sectorProblem(names: string[]): string | null {
  const trimmed = names.map((name) => name.trim());
  if (trimmed.length === 0 || trimmed.length > MAX_TACK_SECTORS) return `Add between 1 and ${MAX_TACK_SECTORS} sectors.`;
  if (trimmed.some((name) => name.length === 0 || name.length > MAX_SECTOR_NAME)) return `Give every sector a name of up to ${MAX_SECTOR_NAME} characters.`;
  if (new Set(trimmed.map((name) => name.toLowerCase())).size !== trimmed.length) return 'Two sectors have the same name.';
  return null;
}

/** One cell being edited: a pass or fail ('' when not marked), and points as typed. */
export interface MarkDraft { passed: '' | 'pass' | 'fail'; points: string }

export function draftFromMarks(sectors: TackCheckSector[], marks: TackCheckMark[]): Record<number, MarkDraft> {
  const draft: Record<number, MarkDraft> = {};
  for (const sector of sectors) {
    const mark = marks.find((m) => m.sectorId === sector.id);
    draft[sector.id] = {
      passed: mark?.passed === true ? 'pass' : mark?.passed === false ? 'fail' : '',
      points: mark?.points === null || mark?.points === undefined ? '' : String(mark.points),
    };
  }
  return draft;
}

/** Points as typed: a whole number from 0 to max, null when empty, or 'invalid'. */
export function parsePoints(text: string, max: number): number | null | 'invalid' {
  const value = text.trim();
  if (value === '') return null;
  if (!/^\d+$/.test(value)) return 'invalid';
  const points = Number(value);
  return points > max ? 'invalid' : points;
}

/** The marks to send for one team, or the first problem with them. Cells left empty are cleared. */
export function marksFromDraft(draft: Record<number, MarkDraft>, max: number): { marks: TackCheckMark[] } | { problem: string } {
  const marks: TackCheckMark[] = [];
  for (const [id, cell] of Object.entries(draft)) {
    const points = parsePoints(cell.points, max);
    if (points === 'invalid') return { problem: `Points go from 0 to ${max}.` };
    const passed = cell.passed === 'pass' ? true : cell.passed === 'fail' ? false : null;
    if (passed !== null || points !== null) marks.push({ sectorId: Number(id), passed, points });
  }
  return { marks };
}

/** The sum of the points typed so far, ignoring anything that isn't a valid number. */
export function draftTotal(draft: Record<number, MarkDraft>, max: number): number {
  return Object.values(draft).reduce((sum, cell) => {
    const points = parsePoints(cell.points, max);
    return typeof points === 'number' ? sum + points : sum;
  }, 0);
}
