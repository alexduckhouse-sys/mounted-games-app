import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FALLBACK_STALE_AFTER_MS,
  RESTART_AFTER_MS,
  TeamProgressStatus,
  endTeamActivity,
  endsActivity,
  listTeamActivities,
  liveActivitiesEnabled,
  needsRestart,
  staleAtFor,
  startTeamActivity,
  toActivityState,
  updateTeamActivity,
  type LiveActivitySummary,
  type TeamProgress,
  type TeamProgressSnapshot,
  type TeamProgressState,
} from './liveActivity';
import { FIXTURE_TEAM_NAME, TEAM_PROGRESS_FIXTURES, fixtureSnapshot } from './fixtures';

const plugin = vi.hoisted(() => ({ start: vi.fn(), update: vi.fn(), end: vi.fn(), list: vi.fn() }));
const isIosApp = vi.hoisted(() => vi.fn());
vi.mock('@capacitor/core', () => ({ registerPlugin: () => plugin }));
vi.mock('./platform', () => ({ isIosApp }));

const observedAt = '2026-10-27T10:00:00.000Z';
const staleAt = '2026-10-27T10:01:00.000Z';
const upcoming: TeamProgress = TEAM_PROGRESS_FIXTURES[1];
const snap = (progress: TeamProgress): TeamProgressSnapshot => ({ progress, observedAt, staleAt });
const upcomingState: TeamProgressState = {
  status: TeamProgressStatus.Upcoming,
  sessionId: 1,
  heatId: 12,
  laneIndex: 3,
  heatsUntil: 3,
  arenaName: 'Arena 1',
  heatLabel: 'Heat 4',
  observedAt,
};

const running: LiveActivitySummary = {
  activityId: 'a1',
  competitionId: 1,
  teamId: 1,
  teamName: FIXTURE_TEAM_NAME,
  startedAt: '2026-10-27T08:00:00.000Z',
  state: upcomingState,
};

beforeEach(() => {
  isIosApp.mockReturnValue(true);
  plugin.start.mockResolvedValue({ activityId: 'a1' });
  plugin.update.mockResolvedValue(undefined);
  plugin.end.mockResolvedValue(undefined);
  plugin.list.mockResolvedValue({ enabled: true, activities: [running] });
});

describe('toActivityState', () => {
  it('keeps the DTO fields apart from the ids, plus when the reading was taken', () => {
    expect(toActivityState(snap(upcoming))).toEqual(upcomingState);
  });

  it.each([TeamProgressStatus.Unknown, TeamProgressStatus.DrawPending])('never shows a count for status %i', (status) => {
    expect(toActivityState(snap({ ...upcoming, status, heatsUntil: 4 })).heatsUntil).toBeNull();
  });

  it('keeps a known count while paused', () => {
    expect(toActivityState(snap({ ...upcoming, status: TeamProgressStatus.Paused, heatsUntil: 2 })).heatsUntil).toBe(2);
  });

  it('keeps zero, which reads as "You\'re on" when in the arena', () => {
    expect(toActivityState(snap({ ...upcoming, status: TeamProgressStatus.InArena, heatsUntil: 0 })).heatsUntil).toBe(0);
  });

  it.each([-1, 1.5, Number.NaN])('drops a count of %s rather than show a wrong number', (heatsUntil) => {
    expect(toActivityState(snap({ ...upcoming, heatsUntil })).heatsUntil).toBeNull();
  });

  it('rewrites API times with more precision or an offset into the form the app parses', () => {
    const state = toActivityState({ ...snap(upcoming), observedAt: '2026-10-27T11:00:00.1234567+01:00' });
    expect(state.observedAt).toBe('2026-10-27T10:00:00.123Z');
    expect(staleAtFor({ ...snap(upcoming), staleAt: '2026-10-27T10:01:00.1234567Z' })).toBe('2026-10-27T10:01:00.123Z');
  });

  it('drops an unreadable observed time', () => {
    expect(toActivityState({ ...snap(upcoming), observedAt: 'soon' }).observedAt).toBeNull();
  });
});

describe('staleAtFor', () => {
  it('uses the server\'s stale time', () => {
    expect(staleAtFor(snap(upcoming))).toBe(staleAt);
  });

  it('falls back to a minute from now when the stale time is unreadable', () => {
    const now = new Date('2026-10-27T12:00:00.000Z');
    expect(staleAtFor({ ...snap(upcoming), staleAt: '' }, now)).toBe(new Date(now.getTime() + FALLBACK_STALE_AFTER_MS).toISOString());
  });

  it('uses the current time by default', () => {
    const before = Date.now();
    const result = Date.parse(staleAtFor({ ...snap(upcoming), staleAt: 'x' }));
    expect(result).toBeGreaterThanOrEqual(before + FALLBACK_STALE_AFTER_MS);
  });
});

describe('endsActivity', () => {
  it('ends for finished and withdrawn teams only', () => {
    const ending = Object.values(TeamProgressStatus).filter(endsActivity);
    expect(ending).toEqual([TeamProgressStatus.Finished, TeamProgressStatus.Withdrawn]);
  });
});

describe('needsRestart', () => {
  const started = new Date(running.startedAt).getTime();

  it('is false before seven and a half hours', () => {
    expect(needsRestart(running, new Date(started + RESTART_AFTER_MS - 1))).toBe(false);
  });

  it('is true from seven and a half hours, ahead of the iOS 8-hour limit', () => {
    expect(needsRestart(running, new Date(started + RESTART_AFTER_MS))).toBe(true);
  });

  it('is false for an unreadable start time', () => {
    expect(needsRestart({ startedAt: 'not a date' })).toBe(false);
  });

  it('uses the current time by default', () => {
    expect(needsRestart({ startedAt: new Date().toISOString() })).toBe(false);
  });
});

describe('outside the iPhone app', () => {
  beforeEach(() => isIosApp.mockReturnValue(false));

  it('does nothing and never calls the plugin', async () => {
    expect(await liveActivitiesEnabled()).toBe(false);
    expect(await startTeamActivity(snap(upcoming), FIXTURE_TEAM_NAME)).toBeNull();
    await updateTeamActivity('a1', snap(upcoming));
    await endTeamActivity('a1');
    expect(await listTeamActivities()).toEqual([]);
    expect(Object.values(plugin).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });
});

describe('inside the iPhone app', () => {
  it('reports whether Live Activities are allowed', async () => {
    expect(await liveActivitiesEnabled()).toBe(true);
    plugin.list.mockResolvedValue({ enabled: false, activities: [] });
    expect(await liveActivitiesEnabled()).toBe(false);
  });

  it('treats a failing plugin as not allowed', async () => {
    plugin.list.mockRejectedValue(new Error('unavailable'));
    expect(await liveActivitiesEnabled()).toBe(false);
  });

  it('starts a card with the team name and the server\'s stale time', async () => {
    expect(await startTeamActivity(snap(upcoming), FIXTURE_TEAM_NAME)).toBe('a1');
    expect(plugin.start).toHaveBeenCalledWith({ competitionId: 1, teamId: 1, teamName: FIXTURE_TEAM_NAME, state: upcomingState, staleAt });
  });

  it('does not start a card for a team that has finished', async () => {
    expect(await startTeamActivity(snap({ ...upcoming, status: TeamProgressStatus.Finished }), FIXTURE_TEAM_NAME)).toBeNull();
    expect(plugin.start).not.toHaveBeenCalled();
  });

  it('updates a running card', async () => {
    await updateTeamActivity('a1', snap(TEAM_PROGRESS_FIXTURES[2]));
    expect(plugin.update).toHaveBeenCalledWith({ activityId: 'a1', state: { ...upcomingState, heatsUntil: 2 }, staleAt });
    expect(plugin.end).not.toHaveBeenCalled();
  });

  it.each([TeamProgressStatus.Finished, TeamProgressStatus.Withdrawn])('ends the card with its last state for status %i', async (status) => {
    await updateTeamActivity('a1', snap({ ...upcoming, status, heatsUntil: null }));
    expect(plugin.end).toHaveBeenCalledWith({ activityId: 'a1', state: { ...upcomingState, status, heatsUntil: null } });
    expect(plugin.update).not.toHaveBeenCalled();
  });

  it('ends a card straight away when the user stops following', async () => {
    await endTeamActivity('a1');
    expect(plugin.end).toHaveBeenCalledWith({ activityId: 'a1', immediately: true });
  });

  it('lists the running cards', async () => {
    expect(await listTeamActivities()).toEqual([running]);
  });
});

describe('fixtures', () => {
  it('already match what the card would show, so the demo never relies on the clean-up', () => {
    for (const progress of TEAM_PROGRESS_FIXTURES) expect(toActivityState(fixtureSnapshot(progress)).heatsUntil).toBe(progress.heatsUntil);
  });

  it('are stale a minute after they were observed, like the endpoint', () => {
    const now = new Date('2026-10-27T10:00:00.000Z');
    expect(fixtureSnapshot(upcoming, now)).toEqual({ progress: upcoming, observedAt: now.toISOString(), staleAt: '2026-10-27T10:01:00.000Z' });
  });

  it('use the current time by default', () => {
    expect(Date.parse(fixtureSnapshot(upcoming).staleAt) - Date.parse(fixtureSnapshot(upcoming).observedAt)).toBeGreaterThan(59_000);
  });
});
