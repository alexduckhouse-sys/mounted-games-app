import { TeamProgressStatus, type TeamProgress, type TeamProgressSnapshot } from './liveActivity';

/**
 * Made-up progress snapshots for trying the Live Activity before the app reads the progress endpoint.
 * They mirror the Swift demo (`LiveActivityDemo.swift`): checking, three heats to go, on, paused, draw
 * pending, finished. No real team or rider.
 */
const base: TeamProgress = {
  competitionId: 1,
  teamId: 1,
  status: TeamProgressStatus.Upcoming,
  sessionId: 1,
  heatId: 12,
  laneIndex: 3,
  heatsUntil: 3,
  arenaName: 'Arena 1',
  heatLabel: 'Heat 4',
};

export const FIXTURE_TEAM_NAME = 'Hollybrook A';

export const TEAM_PROGRESS_FIXTURES: readonly TeamProgress[] = [
  { ...base, status: TeamProgressStatus.Unknown, heatId: null, laneIndex: null, heatsUntil: null, heatLabel: null },
  base,
  { ...base, heatsUntil: 2 },
  { ...base, heatsUntil: 1 },
  { ...base, status: TeamProgressStatus.InArena, heatsUntil: 0 },
  { ...base, status: TeamProgressStatus.Paused, heatsUntil: 0 },
  { ...base, status: TeamProgressStatus.DrawPending, heatId: null, laneIndex: null, heatsUntil: null, heatLabel: 'A Final' },
  { ...base, status: TeamProgressStatus.Finished, heatId: null, laneIndex: null, heatsUntil: null, heatLabel: null },
];

/** Wraps a fixture the way the endpoint does: observed now, stale a minute later. */
export function fixtureSnapshot(progress: TeamProgress, now: Date = new Date()): TeamProgressSnapshot {
  return {
    progress,
    observedAt: now.toISOString(),
    staleAt: new Date(now.getTime() + 60 * 1000).toISOString(),
  };
}
