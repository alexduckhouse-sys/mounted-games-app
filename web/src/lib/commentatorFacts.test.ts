import { describe, expect, it } from 'vitest';
import { race, result } from '../test/factories';
import {
  buildCommentatorBriefing,
  canonicalGameName,
  commentatorFacts,
  formatPrivacySafeRiderPony,
  winStreak,
} from './commentatorFacts';
import type { DeclarationForm, Heat, Session, StandingRow, Team } from '../types';

const won = (id: number, order: number, winner: number) => race(id, {
  orderIndex: order, isComplete: true, results: [result(winner, 1, { points: 3 }), result(winner === 1 ? 2 : 1, 2, { points: 2 })],
});

describe('winStreak', () => {
  it('counts the latest scored races a team won in a row', () => {
    const races = [won(1, 1, 2), won(2, 2, 1), won(3, 3, 1), race(4, { orderIndex: 4 })];
    expect(winStreak(races, 1)).toBe(2);
    expect(winStreak(races, 2)).toBe(0);
  });

  it('stops at a race the team did not win, was eliminated in, or missed', () => {
    const out = race(5, { orderIndex: 5, isComplete: true, results: [result(1, null, { eliminated: true })] });
    expect(winStreak([won(1, 1, 1), out], 1)).toBe(0);
    expect(winStreak([won(1, 1, 1), race(6, { orderIndex: 6, isComplete: true, results: [] })], 1)).toBe(0);
  });
});

describe('commentatorFacts', () => {
  const standings = [
    { teamId: 1, totalPoints: 12, racesRun: 3 },
    { teamId: 2, totalPoints: 11, racesRun: 3 },
    { teamId: 3, totalPoints: 9, racesRun: 3 },
    { teamId: 4, totalPoints: 12, racesRun: 3 },
  ];

  it('says who is leading, who is behind and by how much, and any winning streak', () => {
    const facts = commentatorFacts([1, 2, 3], [won(1, 1, 1), won(2, 2, 1)], standings);
    expect(facts[1]).toBe('Won the last 2 races · Leading');
    expect(facts[2]).toBe('1 point behind 1st');
    expect(facts[3]).toBe('3 points behind 1st');
  });

  it('mentions a single win, and says nothing for a team level with the leader', () => {
    const facts = commentatorFacts([2, 4], [won(1, 1, 2)], standings);
    expect(facts[2]).toBe('Won the last race · 1 point behind 1st');
    expect(facts[4]).toBeUndefined();
  });

  it('says nothing about standings before a race has been run, or for a team not in them', () => {
    expect(commentatorFacts([1], [], [{ teamId: 1, totalPoints: 0, racesRun: 0 }])).toEqual({});
    expect(commentatorFacts([9], [], standings)).toEqual({});
  });
});

describe('buildCommentatorBriefing (#11)', () => {
  it('normalises race aliases, formats privacy-safe rider/pony squads, and calculates cutline stakes', () => {
    expect(canonicalGameName('Pole Bending')).toBe('Bending');
    expect(canonicalGameName('Mug Shuffle')).toBe('Two Mug');

    expect(
      formatPrivacySafeRiderPony({
        fullName: 'Ella Hughes',
        horseName: 'Pickle',
        useInitialOnly: true,
        isCaptain: true,
        isReserve: false,
      }),
    ).toBe('Ella H. on Pickle (Capt)');

    const teams: Team[] = [
      { id: 1, competitionId: 1, competitionSectionId: 1, sectionName: 'U15', clubId: 1, clubName: 'Kent', suffix: 'A', displayName: 'Kent A', isHorsConcours: false },
      { id: 2, competitionId: 1, competitionSectionId: 1, sectionName: 'U15', clubId: 2, clubName: 'Surrey', suffix: 'A', displayName: 'Surrey A', isHorsConcours: false },
      { id: 3, competitionId: 1, competitionSectionId: 1, sectionName: 'U15', clubId: 3, clubName: 'Essex', suffix: 'A', displayName: 'Essex A', isHorsConcours: false },
    ];

    const standings: StandingRow[] = [
      { teamId: 1, teamName: 'Kent A', clubName: 'Kent', totalPoints: 25, racesRun: 4, wins: 3, eliminations: 0 },
      { teamId: 2, teamName: 'Surrey A', clubName: 'Surrey', totalPoints: 20, racesRun: 4, wins: 1, eliminations: 0 },
      { teamId: 3, teamName: 'Essex A', clubName: 'Essex', totalPoints: 18, racesRun: 4, wins: 0, eliminations: 0 },
    ];

    const heat: Heat = {
      id: 200,
      sessionId: 20,
      label: 'Heat 1',
      orderIndex: 1,
      entries: [
        { id: 1, teamId: 1, teamName: 'Kent A', laneIndex: 1 },
        { id: 2, teamId: 2, teamName: 'Surrey A', laneIndex: 2 },
        { id: 3, teamId: 3, teamName: 'Essex A', laneIndex: 3 },
      ],
      races: [
        {
          id: 2001,
          heatId: 200,
          name: 'Pole Bending',
          orderIndex: 1,
          isComplete: false,
          results: [],
        },
      ],
    };

    const s1: Session = {
      id: 19,
      competitionId: 1,
      competitionSectionId: 1,
      sectionName: 'U15',
      name: 'Session 1',
      status: 2,
      orderIndex: 1,
      isBreak: false,
      kind: 0,
      heats: [
        {
          id: 190,
          sessionId: 19,
          orderIndex: 1,
          entries: [],
          races: [
            {
              id: 1901,
              heatId: 190,
              name: 'Bending',
              orderIndex: 1,
              isComplete: true,
              results: [{ id: 1, teamId: 1, teamName: 'Kent A', placing: 1, eliminated: false, points: 5 }],
            },
          ],
        },
      ],
    };

    const s2: Session = {
      id: 20,
      competitionId: 1,
      competitionSectionId: 1,
      sectionName: 'U15',
      name: 'Session 2',
      status: 1,
      orderIndex: 2,
      isBreak: false,
      kind: 0,
      heats: [heat],
    };

    const declarations: DeclarationForm[] = [
      {
        id: 1,
        teamId: 1,
        teamName: 'Kent A',
        competitionId: 1,
        competitionName: 'Summer',
        submittedAt: '2026-07-01T10:00:00Z',
        isLocked: true,
        riders: [
          {
            id: 10,
            fullName: 'Ella Hughes',
            horseName: 'Pickle',
            useInitialOnly: true,
            isCaptain: true,
            isReserve: false,
            orderIndex: 0,
          },
        ],
      },
    ];

    const briefing = buildCommentatorBriefing({
      competitionId: 1,
      session: s2,
      heat,
      standings,
      teams,
      allSessions: [s1, s2],
      declarations,
      finalistCount: 2,
    });

    expect(briefing.currentRaceName).toBe('Pole Bending');
    expect(briefing.lanes[0].ridersAndPonies).toEqual(['Ella H. on Pickle (Capt)']);
    expect(briefing.lanes[0].gameSpecialistNote).toBe('Won their previous Bending run');
    expect(briefing.lanes[1].stakesHeadline).toContain('above the Top 2 A-Final cutline');
    expect(briefing.lanes[2].stakesHeadline).toContain('off the Top 2 A-Final cutline');
  });
});
