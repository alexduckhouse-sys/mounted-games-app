import { describe, expect, it } from 'vitest';
import { heat, race, session } from '../test/factories';
import { computeTimings } from './time';
import { timetableRows } from './timetableRows';
import { heatChooserGroups } from './heatChooser';
import type { Session } from '../types';

const rowsFor = (sessions: Session[]) => timetableRows(sessions, computeTimings(sessions), true);
const label = (row: { heat: { label?: string | null } | null; heatIndex: number }) => row.heat?.label || `Heat ${row.heatIndex + 1}`;
const done = (id: number) => race(id, { isComplete: true });

describe('heatChooserGroups', () => {
  const seniors = session(1, {
    competitionSectionId: 1, sectionName: 'Teams Seniors', orderIndex: 0, status: 2, scheduledStart: '2026-10-29T07:45:00',
    heats: [heat(1, { sessionId: 1, orderIndex: 0, label: 'Heat 1', races: [done(1)] })],
  });
  const seniorsFinal = session(2, {
    competitionSectionId: 1, sectionName: 'Teams Seniors', orderIndex: 1, status: 1, scheduledStart: '2026-10-29T08:20:00',
    heats: [heat(2, { sessionId: 2, orderIndex: 0, label: 'A Final', races: [race(2)] })],
  });
  const juniors = session(3, {
    competitionSectionId: 2, sectionName: 'Teams Juniors', orderIndex: 2, status: 0, scheduledStart: '2026-10-29T09:00:00',
    heats: [heat(3, { sessionId: 3, orderIndex: 0, label: 'Heat 2', races: [race(3)] }), heat(4, { sessionId: 3, orderIndex: 1, label: 'Heat 1', races: [race(4)] })],
  });

  it('groups the heats by age group in the order each group first runs, and each group in running order', () => {
    const groups = heatChooserGroups(rowsFor([juniors, seniorsFinal, seniors]), 1, label);
    expect(groups.map((g) => g.section)).toEqual(['Seniors', 'Juniors']);
    expect(groups[0].rows.map((r) => r.label)).toEqual(['Heat 1', 'A Final']);
    expect(groups[1].rows).toHaveLength(2);
    expect(groups[1].rows.map((r) => r.time!.getHours())).toEqual([9, 9]);
  });

  it('marks the current heat and says Finished, On now, or nothing', () => {
    const [seniorsGroup, juniorsGroup] = heatChooserGroups(rowsFor([seniors, seniorsFinal, juniors]), 1, label);
    expect(seniorsGroup.rows.map((r) => [r.status, r.current])).toEqual([['finished', true], ['live', false]]);
    expect(juniorsGroup.rows.every((r) => r.status === 'later' && !r.current)).toBe(true);
  });

  it('keeps only the day of the current heat, and leaves out breaks', () => {
    const tomorrow = session(5, {
      competitionSectionId: 1, sectionName: 'Teams Seniors', orderIndex: 3, scheduledStart: '2026-10-30T09:00:00',
      heats: [heat(5, { sessionId: 5, orderIndex: 0, label: 'Heat 3', races: [race(5)] })],
    });
    const lunch = session(6, { kind: 1, isBreak: true, name: 'Lunch', orderIndex: 4, scheduledStart: '2026-10-29T12:00:00', heats: [] });
    const rows = rowsFor([seniors, seniorsFinal, tomorrow, lunch]);
    const today = heatChooserGroups(rows, 1, label);
    expect(today).toHaveLength(1);
    expect(today[0].rows.map((r) => r.heatId)).toEqual([1, 2]);
    expect(heatChooserGroups(rows, 5, label)[0].rows.map((r) => r.heatId)).toEqual([5]);
  });

  it('lists every day when the current heat has no time, and falls back to the session name for a group', () => {
    const loose = session(7, { competitionSectionId: null, sectionName: null, name: 'Open', orderIndex: 0, heats: [heat(7, { sessionId: 7, orderIndex: 0, races: [race(7)] })] });
    const groups = heatChooserGroups(rowsFor([loose, seniors]), 7, label);
    expect(groups.map((g) => g.section).sort()).toEqual(['Open', 'Seniors']);
    expect(groups.flatMap((g) => g.rows).find((r) => r.heatId === 7)).toMatchObject({ current: true, time: null, label: 'Heat 1' });
  });
});
