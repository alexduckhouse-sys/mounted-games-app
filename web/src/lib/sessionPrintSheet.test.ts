import { describe, expect, it } from 'vitest';
import type { PrintableResults, PrintableScoreHeat } from '../pages/eventTools/eventToolsTypes';
import {
  buildCompletedSessionNoticeboardSheet,
  buildSessionSelectorOptions,
  filterPrintableHeatsBySession,
  isPrintableHeatCompleted,
} from './sessionPrintSheet';

describe('sessionPrintSheet (Single-Session Noticeboard 1-Pager)', () => {
  const heats: PrintableScoreHeat[] = [
    {
      heatId: 1,
      label: 'Heat 1',
      sectionName: 'Under 17',
      sessionName: 'Session 1',
      scheduledStart: '2026-05-01T09:00:00Z',
      races: [
        {
          raceId: 11,
          name: 'Bending',
          teams: [
            { teamId: 1, teamName: 'Oakley A', placing: 1, eliminated: false, points: 5, lane: 1 },
            { teamId: 2, teamName: 'Kent A', placing: 2, eliminated: false, points: 4, lane: 2 },
          ],
        },
      ],
    },
    {
      heatId: 2,
      label: 'Heat 1',
      sectionName: 'Open',
      sessionName: 'Session 2',
      scheduledStart: '2026-05-01T10:00:00Z',
      races: [
        {
          raceId: 21,
          name: '2 Flag',
          teams: [
            { teamId: 3, teamName: 'Sussex A', placing: null, eliminated: false, points: null, lane: 1 },
          ],
        },
      ],
    },
  ];

  const results: PrintableResults = {
    competition: {
      id: 7,
      name: 'Spring Show',
      location: 'Newark',
      startDate: '2026-05-01T00:00:00Z',
      endDate: null,
    },
    isProvisional: true,
    sections: [
      {
        competitionSectionId: 10,
        sectionName: 'Under 17',
        results: [
          {
            rank: 1,
            teamId: 1,
            teamName: 'Oakley A',
            clubName: 'Oakley',
            totalPoints: 5,
            racesRun: 1,
            wins: 1,
            eliminations: 0,
          },
        ],
      },
      {
        competitionSectionId: 20,
        sectionName: 'Open',
        results: [
          {
            rank: 1,
            teamId: 3,
            teamName: 'Sussex A',
            clubName: 'Sussex',
            totalPoints: 0,
            racesRun: 0,
            wins: 0,
            eliminations: 0,
          },
        ],
      },
    ],
  };

  it('detects completed heats and builds Session Selector options', () => {
    expect(isPrintableHeatCompleted(heats[0])).toBe(true);
    expect(isPrintableHeatCompleted(heats[1])).toBe(false);

    const options = buildSessionSelectorOptions(heats);
    expect(options.map((o) => o.value)).toEqual(['all', 'Session 1', 'Session 2']);
    expect(options[1].isCompleted).toBe(true);
    expect(options[1].label).toContain('Session 1 · Under 17 (Completed)');
    expect(options[2].isCompleted).toBe(false);
  });

  it('filters heats by session and builds the 1-page Completed Session Noticeboard Sheet', () => {
    expect(filterPrintableHeatsBySession(heats, 'Session 1')).toHaveLength(1);
    expect(filterPrintableHeatsBySession(heats, 'all')).toHaveLength(2);

    const sheet = buildCompletedSessionNoticeboardSheet(results, heats, 'all');
    expect(sheet).not.toBeNull();
    expect(sheet!.sessionName).toBe('Session 1');
    expect(sheet!.isCompleted).toBe(true);
    expect(sheet!.heats).toHaveLength(1);
    expect(sheet!.heats[0].sessionName).toBe('Session 1');
    expect(sheet!.sections.map((s) => s.sectionName)).toEqual(['Under 17']);
  });
});
