import { describe, expect, it } from 'vitest';
import { competition, heat, session, team } from '../test/factories';
import { CLASH_WINDOW_MINUTES, detectTimetableClashes, nextUpAcrossTeams } from './timetableClashes';

describe('nextUpAcrossTeams', () => {
  const entry = (teamId: number, laneIndex = teamId) => ({
    id: teamId,
    teamId,
    teamName: `Team ${teamId}`,
    laneIndex,
  });

  it('returns an empty list when fewer than 2 followed teams exist in the competition', () => {
    const data = competition({
      teams: [team(1, { displayName: 'Oakley A' }), team(2, { displayName: 'Oakley B' })],
      sessions: [
        session(1, {
          arenaName: 'Arena 1',
          scheduledStart: '2026-07-01T10:00:00Z',
          heats: [heat(10, { entries: [entry(1, 2)] })],
        }),
      ],
    });

    expect(nextUpAcrossTeams(data, new Set())).toEqual([]);
    expect(nextUpAcrossTeams(data, new Set([1]))).toEqual([]);
    expect(nextUpAcrossTeams(data, new Set([1, 999]))).toEqual([]);
  });

  it('returns chronological next rides across 2+ followed teams with arena, heat label, lane, and bib info', () => {
    const data = competition({
      teams: [
        team(1, { displayName: 'Oakley A', bibColour: 'Red', bibDescription: 'White stars' }),
        team(2, { displayName: 'Oakley B', bibColour: 'Blue' }),
        team(3, { displayName: 'Done Team' }),
      ],
      sessions: [
        session(1, {
          arenaName: 'Main Arena',
          scheduledStart: '2026-07-01T10:30:00Z',
          heats: [heat(20, { label: 'Heat 2', entries: [entry(1, 4)] })],
        }),
        session(2, {
          arenaName: 'Ring 2',
          scheduledStart: '2026-07-01T10:10:00Z',
          heats: [heat(10, { label: 'Heat 1', entries: [entry(2, 1)] })],
        }),
        session(3, {
          arenaName: 'Ring 2',
          status: 2,
          scheduledStart: '2026-07-01T09:00:00Z',
          heats: [heat(5, { finishedAt: '2026-07-01T09:20:00Z', entries: [entry(3, 2)] })],
        }),
      ],
    });

    const rides = nextUpAcrossTeams(data, new Set([1, 2, 3]));
    expect(rides).toHaveLength(2);
    expect(rides[0]).toMatchObject({
      team: { id: 2, displayName: 'Oakley B', bibColour: 'Blue' },
      heatId: 10,
      sessionId: 2,
      heatLabel: 'Heat 1',
      arenaName: 'Ring 2',
      lane: 1,
    });
    expect(rides[1]).toMatchObject({
      team: { id: 1, displayName: 'Oakley A', bibColour: 'Red', bibDescription: 'White stars' },
      heatId: 20,
      sessionId: 1,
      heatLabel: 'Heat 2',
      arenaName: 'Main Arena',
      lane: 4,
    });
  });

  it('falls back to single session arenaName or null when unnamed, and sorts ties by heatId and lane', () => {
    const data = competition({
      teams: [team(1, { displayName: 'Alpha' }), team(2, { displayName: 'Bravo' }), team(3, { displayName: 'Charlie' })],
      sessions: [
        session(1, {
          arenaName: null,
          scheduledStart: null,
          heats: [heat(11, { entries: [entry(1, 3), entry(2, 1)] }), heat(12, { entries: [entry(3, 2)] })],
        }),
      ],
    });

    const rides = nextUpAcrossTeams(data, new Set([1, 2, 3]));
    expect(rides.map((r) => [r.team.id, r.heatId, r.lane, r.arenaName])).toEqual([
      [2, 11, 1, null],
      [1, 11, 3, null],
      [3, 12, 2, null],
    ]);
  });
});

describe('detectTimetableClashes', () => {
  const entry = (teamId: number, laneIndex = 1) => ({
    id: teamId * 100 + laneIndex,
    teamId,
    teamName: `Team ${teamId}`,
    laneIndex,
  });

  it('detects clashes within 15 minutes in different arenas for two followed teams', () => {
    const data = competition({
      teams: [team(1, { displayName: 'Oakley U12' }), team(2, { displayName: 'Oakley U17' }), team(3, { displayName: 'Other' })],
      sessions: [
        session(1, {
          arenaName: 'Arena 1',
          scheduledStart: '2026-07-01T10:00:00Z',
          heats: [heat(1, { label: 'Heat 1', entries: [entry(1, 2)] })],
        }),
        session(2, {
          arenaName: 'Arena 2',
          scheduledStart: '2026-07-01T10:10:00Z',
          heats: [heat(2, { label: 'Heat 3', entries: [entry(2, 5)] })],
        }),
      ],
    });

    const clashes = detectTimetableClashes(data, { followedTeamIds: new Set([1, 2]) });
    expect(CLASH_WINDOW_MINUTES).toBe(15);
    expect(clashes).toHaveLength(1);
    expect(clashes[0]).toMatchObject({
      key: 'clash-1-2-1-2',
      reason: 'followed',
      sharedDetail: null,
      gapMinutes: 10,
      first: { team: { id: 1 }, heatId: 1, arenaName: 'Arena 1', lane: 2 },
      second: { team: { id: 2 }, heatId: 2, arenaName: 'Arena 2', lane: 5 },
    });
    expect(clashes[0].summary).toContain('10 min apart in different arenas');
  });

  it('ignores heats in the same arena, finished heats, or heats further apart than windowMinutes', () => {
    const data = competition({
      teams: [team(1, { displayName: 'Team A' }), team(2, { displayName: 'Team B' })],
      sessions: [
        session(1, {
          arenaName: 'Arena 1',
          scheduledStart: '2026-07-01T10:00:00Z',
          heats: [
            heat(1, { entries: [entry(1, 1)] }),
            heat(2, { scheduledStart: '2026-07-01T10:05:00Z', entries: [entry(2, 2)] }),
          ],
        }),
        session(2, {
          arenaName: 'Arena 2',
          scheduledStart: '2026-07-01T10:25:00Z',
          heats: [heat(3, { entries: [entry(2, 3)] })],
        }),
        session(3, {
          arenaName: 'Arena 2',
          status: 2,
          scheduledStart: '2026-07-01T10:02:00Z',
          heats: [heat(4, { finishedAt: '2026-07-01T10:08:00Z', entries: [entry(2, 4)] })],
        }),
      ],
    });

    expect(detectTimetableClashes(data, { followedTeamIds: new Set([1, 2]) })).toEqual([]);
  });

  it('detects clashes when two teams share trainerUserId or declared ponyPassportNumber / horseName', () => {
    const data = competition({
      teams: [
        team(1, { displayName: 'Kent A', trainerUserId: 'trainer-1', trainerName: 'Sarah Jones' }),
        team(2, { displayName: 'Kent B', trainerUserId: 'trainer-1', trainerName: 'Sarah Jones' }),
        team(3, { displayName: 'Sussex A', trainerUserId: 'trainer-2', trainerName: null }),
        team(4, { displayName: 'Sussex B', trainerUserId: 'trainer-2', trainerName: null }),
        team(5, { displayName: 'Pony A' }),
        team(6, { displayName: 'Pony B' }),
      ],
      sessions: [
        session(1, {
          arenaName: 'Arena 1',
          scheduledStart: '2026-07-01T11:00:00Z',
          heats: [heat(10, { entries: [entry(2, 1), entry(4, 2), entry(5, 3), entry(999, 4)] })],
        }),
        session(2, {
          arenaName: 'Arena 2',
          scheduledStart: '2026-07-01T11:00:00Z',
          heats: [heat(20, { entries: [entry(1, 1), entry(3, 2), entry(6, 3)] })],
        }),
      ],
    });

    const clashes = detectTimetableClashes(data, {
      declarations: [
        {
          teamId: 5,
          riders: [
            { horseName: '  Flash ', ponyPassportNumber: 'UK-12345' },
            { horseName: '   ', ponyPassportNumber: null },
          ],
        },
        {
          teamId: 5,
          riders: [{ horseName: null, ponyPassportNumber: 'UK-99999' }],
        },
        {
          teamId: 6,
          riders: [{ horseName: 'Starlight', ponyPassportNumber: 'uk-12345' }],
        },
      ],
    });

    expect(clashes).toHaveLength(3);
    expect(clashes[0]).toMatchObject({
      reason: 'trainer',
      sharedDetail: 'Sarah Jones',
      gapMinutes: 0,
      first: { team: { id: 1 } },
      second: { team: { id: 2 } },
    });
    expect(clashes[0].summary).toContain('at the same time in different arenas');
    expect(clashes[1]).toMatchObject({
      reason: 'trainer',
      sharedDetail: 'Shared trainer',
    });
    expect(clashes[2]).toMatchObject({
      reason: 'pony',
      sharedDetail: 'Flash',
    });
  });

  it('orders first/second by earlier timestamp and deduplicates identical team/heat clash pairs', () => {
    const data = competition({
      teams: [team(10, { displayName: 'Later Team' }), team(20, { displayName: 'Earlier Team' })],
      sessions: [
        session(1, {
          arenaName: 'Ring A',
          scheduledStart: '2026-07-01T12:12:00Z',
          heats: [heat(100, { entries: [entry(10, 1), entry(10, 2)] })],
        }),
        session(2, {
          arenaName: 'Ring B',
          scheduledStart: '2026-07-01T12:00:00Z',
          heats: [heat(200, { entries: [entry(20, 1)] })],
        }),
      ],
    });

    const clashes = detectTimetableClashes(data, { followedTeamIds: new Set([10, 20]) });
    expect(clashes).toHaveLength(1);
    expect(clashes[0].first.team.id).toBe(20);
    expect(clashes[0].second.team.id).toBe(10);
    expect(clashes[0].gapMinutes).toBe(12);
  });
});
