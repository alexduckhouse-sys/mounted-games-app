import { tr } from '../i18n/translate';
import type { TackCheckMark, TackCheckMode, TackCheckSector, TackCheckTeam } from '../types';

/** The sectors a section starts with, as the API's `TackCheckService.DefaultSectors`. */
export const DEFAULT_TACK_SECTORS = ['Saddle/Girth', 'Bridle/Bit', 'Rider Hat/Boots', 'Turnout'];
export const MAX_TACK_SECTORS = 12;
export const MAX_SECTOR_NAME = 60;

export const TACK_MODES: { mode: TackCheckMode; label: string; detail: string }[] = [
  { mode: 0, get label() { return tr('ops3.tack.mode0'); }, get detail() { return tr('ops3.tack.mode0d'); } },
  { mode: 1, get label() { return tr('ops3.tack.mode1'); }, get detail() { return tr('ops3.tack.mode1d'); } },
  { mode: 2, get label() { return tr('ops3.tack.mode2'); }, get detail() { return tr('ops3.tack.mode2d'); } },
];

/** True for the modes where stewards give points rather than a pass or fail. */
export const isScored = (mode: TackCheckMode) => mode !== 0;

/** What is wrong with this list of sector names, as the API checks it, or null when it can be saved. */
export function sectorProblem(names: string[]): string | null {
  const trimmed = names.map((name) => name.trim());
  if (trimmed.length === 0 || trimmed.length > MAX_TACK_SECTORS) return tr('ops3.tack.sectorsRange', { max: MAX_TACK_SECTORS });
  if (trimmed.some((name) => name.length === 0 || name.length > MAX_SECTOR_NAME)) return tr('ops3.tack.sectorName', { max: MAX_SECTOR_NAME });
  if (new Set(trimmed.map((name) => name.toLowerCase())).size !== trimmed.length) return tr('ops3.tack.sameName');
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
    if (points === 'invalid') return { problem: tr('ops3.tack.pointsRange', { max }) };
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

export type TackMarkWithRiders = TackCheckMark & { riderPoints?: (number | null)[] | null };
export type TackTeamWithRiders = TackCheckTeam & { riders?: string[] | null; marks: TackMarkWithRiders[] };

/** Default rider slots when a team has not submitted a declaration form yet. */
export function defaultRiderSlots(format = 2): string[] {
  const count = format === 3 ? 1 : format === 1 ? 2 : 4;
  return Array.from({ length: count }, (_, i) => `Rider ${i + 1}`);
}

/** The rider rows for a team's tack check grid: declared riders if present, otherwise default slots. */
export function teamRiders(team: { riders?: string[] | null }, format = 2): string[] {
  return team.riders && team.riders.length > 0 ? team.riders : defaultRiderSlots(format);
}

/** Sector id -> points typed for each rider slot on the team. */
export type RiderGridDraft = Record<number, string[]>;

export function riderGridFromMarks(sectors: TackCheckSector[], marks: TackMarkWithRiders[], riderCount: number): RiderGridDraft {
  const count = Math.max(1, riderCount);
  const grid: RiderGridDraft = {};
  for (const sector of sectors) {
    const mark = marks.find((m) => m.sectorId === sector.id);
    if (Array.isArray(mark?.riderPoints) && mark.riderPoints.length > 0) {
      grid[sector.id] = Array.from({ length: count }, (_, i) => {
        const val = mark.riderPoints?.[i];
        return val === null || val === undefined ? '' : String(val);
      });
    } else if (mark?.points !== null && mark?.points !== undefined) {
      grid[sector.id] = Array.from({ length: count }, (_, i) => (i === 0 ? String(mark.points) : ''));
    } else {
      grid[sector.id] = Array.from({ length: count }, () => '');
    }
  }
  return grid;
}

export function marksFromRiderGrid(grid: RiderGridDraft, max: number): { marks: TackMarkWithRiders[] } | { problem: string } {
  const marks: TackMarkWithRiders[] = [];
  for (const [id, cells] of Object.entries(grid)) {
    const riderPoints: (number | null)[] = [];
    let hasAny = false;
    for (const text of cells) {
      const parsed = parsePoints(text, max);
      if (parsed === 'invalid') return { problem: tr('ops3.tack.pointsRange', { max }) };
      if (parsed !== null) hasAny = true;
      riderPoints.push(parsed);
    }
    if (hasAny) {
      const points = riderPoints.reduce<number>((sum, p) => sum + (p ?? 0), 0);
      marks.push({ sectorId: Number(id), passed: null, points, riderPoints });
    }
  }
  return { marks };
}

export function riderRowTotal(grid: RiderGridDraft, riderIndex: number, max: number): number {
  return Object.values(grid).reduce((sum, cells) => {
    const points = parsePoints(cells[riderIndex] ?? '', max);
    return typeof points === 'number' ? sum + points : sum;
  }, 0);
}

export function sectorColumnTotal(grid: RiderGridDraft, sectorId: number, max: number): number {
  return (grid[sectorId] ?? []).reduce((sum, text) => {
    const points = parsePoints(text, max);
    return typeof points === 'number' ? sum + points : sum;
  }, 0);
}

export function riderGridTotal(grid: RiderGridDraft, max: number): number {
  return Object.keys(grid).reduce((sum, id) => sum + sectorColumnTotal(grid, Number(id), max), 0);
}
