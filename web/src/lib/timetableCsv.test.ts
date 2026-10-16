import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../types';
import { heat, race, session } from '../test/factories';
import { computeTimings } from './time';
import { exportTimetableCsv } from './timetableCsv';

let download: { name: string; text: Promise<string> } | undefined;

beforeEach(() => {
  download = undefined;
  let blob: Blob;
  URL.createObjectURL = vi.fn((b: Blob) => { blob = b; return 'blob:x'; });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
    download = { name: this.download, text: blob.text() };
  });
});

async function exportRows(sessions: Session[], name = 'Spring Games') {
  exportTimetableCsv(name, sessions, computeTimings(sessions));
  // Blob.text() already drops the byte-order mark; csv.test.ts checks it is written.
  const text = await download!.text;
  return { name: download!.name, lines: text.split('\r\n') };
}

const dateText = (iso: string) => new Date(iso).toLocaleDateString();
const timeText = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

describe('exportTimetableCsv', () => {
  it('names the file after the competition and writes the header', async () => {
    const { name, lines } = await exportRows([], 'Spring Games / 2026');
    expect(name).toBe('Spring_Games_2026-timetable.csv');
    expect(lines).toEqual(['Date,Time,Arena,Age group,Session,Heat,Status,Teams']);
  });

  it('writes one row per heat with times, arena, status and teams in lane order', async () => {
    const start = '2026-06-01T09:00:00Z';
    const finished = heat(1, { label: 'Heat A', races: [race(1, { isComplete: true })], entries: [
      { id: 1, teamId: 2, teamName: 'Second', laneIndex: 2 }, { id: 2, teamId: 1, teamName: 'First', laneIndex: 1 },
    ] });
    const running = heat(2, { orderIndex: 2, entries: [{ id: 3, teamId: 3, teamName: 'Third', laneIndex: 1 }] });
    const { lines } = await exportRows([
      session(1, { name: 'Seniors, heats', arenaName: 'Main', sectionName: 'Seniors', scheduledStart: start, status: 1, heats: [running, finished] }),
      session(2, { orderIndex: 2, name: 'Juniors', status: 0, heats: [heat(3)] }),
    ]);
    expect(lines[1]).toBe(`${dateText(start)},${timeText(start)},Main,Seniors,"Seniors, heats",Heat A,OVER,First | Second`);
    expect(lines[2].split(',').slice(-3)).toEqual(['Heat 2', 'IN ARENA', 'Third']);
    expect(lines[3].split(',').slice(-3)).toEqual(['Heat 1', 'UPCOMING', '']);
  });

  it('lists breaks, briefings and custom items on one row each', async () => {
    const start = '2026-06-01T09:00:00Z';
    const { lines } = await exportRows([
      session(1, { orderIndex: 1, kind: 1, name: 'Lunch', scheduledStart: start, arenaName: 'Main' }),
      session(2, { orderIndex: 2, kind: 2, name: 'Riders', scheduledStart: start }),
      session(3, { orderIndex: 3, kind: 3, name: 'Prizegiving' }),
      { ...session(4, { orderIndex: 4, name: 'Legacy', isBreak: true }), kind: undefined } as unknown as Session,
    ]);
    expect(lines[1]).toBe(`${dateText(start)},${timeText(start)},Main,,Lunch,BREAK,,`);
    expect(lines[2]).toBe(`${dateText(start)},${timeText(start)},,,Riders,BRIEFING,,`);
    expect(lines[3].split(',').slice(2)).toEqual(['', '', 'Prizegiving', 'CUSTOM', '', '']);
    expect(lines[4].split(',').slice(-4, -2)).toEqual(['Legacy', 'BREAK']);
  });

  it('copes with sessions that have no times, arena or age group', async () => {
    const { lines } = await exportRows([
      { ...session(1, { name: 'Open', heats: [heat(1)] }), sectionName: undefined, arenaName: undefined } as unknown as Session,
      { ...session(2, { orderIndex: 2, name: 'Legacy race', isBreak: false, heats: [heat(2, { label: null })] }), kind: undefined } as unknown as Session,
    ]);
    expect(lines[1]).toBe(',,,,Open,Heat 1,UPCOMING,');
    expect(lines[2].split(',').slice(-4, -1)).toEqual(['Legacy race', 'Heat 1', 'UPCOMING']);
  });

  it('uses the shifted time when the schedule has slipped', async () => {
    const scheduled = '2026-06-01T09:00:00Z';
    const started = '2026-06-01T09:20:00Z';
    const { lines } = await exportRows([session(1, { scheduledStart: scheduled, startedAt: started, status: 1, heats: [heat(1)] })]);
    expect(lines[1].split(',')[1]).toBe(timeText(started));
  });
});
