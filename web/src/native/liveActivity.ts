import { registerPlugin } from '@capacitor/core';
import { isIosApp } from './platform';

/**
 * The lock-screen and Dynamic Island card for a followed team (iOS Live Activity), driven by the app.
 *
 * The Swift side is `ios/App/App/LiveActivityPlugin.swift`; the card itself is the `MGLiveActivity` widget
 * extension. Field names and numbers mirror the TeamProgress DTO (camelCase, numeric status) and the
 * snapshot envelope of `GET /api/competitions/{competitionId}/teams/{teamId}/progress`:
 * `{ progress, observedAt, staleAt }`. The native coordinator reads this endpoint directly. `staleAt` becomes the activity's stale date, after which iOS
 * shows the card as out of date.
 *
 * Nothing here may carry a rider's name or anything private: the card shows on a locked phone.
 */

/** TeamProgress status, as numbers on the wire. */
export const TeamProgressStatus = {
  Unknown: 0,
  Upcoming: 1,
  InArena: 2,
  Paused: 3,
  DrawPending: 4,
  Finished: 5,
  Withdrawn: 6,
} as const;
export type TeamProgressStatus = (typeof TeamProgressStatus)[keyof typeof TeamProgressStatus];

/** Mirrors the TeamProgress DTO. */
export interface TeamProgress {
  competitionId: number;
  teamId: number;
  status: TeamProgressStatus;
  sessionId: number | null;
  heatId: number | null;
  /** One-based drawn lane. */
  laneIndex: number | null;
  /** Unfinished heats ahead in the team's own arena, including one that is running. Null when not known. */
  heatsUntil: number | null;
  arenaName: string | null;
  heatLabel: string | null;
}

/** Mirrors the progress endpoint's response. Times are UTC ISO strings. */
export interface TeamProgressSnapshot {
  progress: TeamProgress;
  /** When the server read the competition (not when the team's progress last changed). */
  observedAt: string;
  /** When this reading stops counting as current (observedAt plus 60 seconds). */
  staleAt: string;
}

/**
 * What changes on the card (the Swift ContentState): the DTO without its ids, which are fixed when the
 * activity starts, plus when the reading was taken so an out-of-date card can say how old it is.
 */
export type TeamProgressState = Omit<TeamProgress, 'competitionId' | 'teamId'> & { observedAt: string | null };

export interface LiveActivitySummary {
  activityId: string;
  competitionId: number;
  teamId: number;
  teamName: string;
  /** ISO time the activity started; iOS ends an activity after 8 hours (see `needsRestart`). */
  startedAt: string;
  state: TeamProgressState;
}

export interface LiveActivityPlugin {
  /** Starts a card for one team. An existing card for the same team is replaced, never doubled. */
  start(options: { competitionId: number; teamId: number; teamName: string; state: TeamProgressState; staleAt: string }): Promise<{ activityId: string }>;
  /** Updates the card. A Finished or Withdrawn state ends it instead. */
  update(options: { activityId: string; state: TeamProgressState; staleAt: string }): Promise<void>;
  /** Ends the card, optionally showing a last state on the lock screen for a while. */
  end(options: { activityId: string; state?: TeamProgressState; immediately?: boolean }): Promise<void>;
  /** Whether the user allows Live Activities for the app, and the cards running now. */
  list(): Promise<{ enabled: boolean; activities: LiveActivitySummary[] }>;
}

export const LiveActivity = registerPlugin<LiveActivityPlugin>('LiveActivity');

/** Matches the server's freshness bound; used if a snapshot's `staleAt` can't be read. */
export const FALLBACK_STALE_AFTER_MS = 60 * 1000;

/** iOS ends an activity after 8 hours. Restart a little before that so a long event day keeps its card. */
export const RESTART_AFTER_MS = 7.5 * 60 * 60 * 1000;

const NO_COUNT: ReadonlySet<number> = new Set([TeamProgressStatus.Unknown, TeamProgressStatus.DrawPending]);
const ENDS: ReadonlySet<number> = new Set([TeamProgressStatus.Finished, TeamProgressStatus.Withdrawn]);

/** True when this status means the team has nothing more to follow in this competition. */
export function endsActivity(status: TeamProgressStatus): boolean {
  return ENDS.has(status);
}

/**
 * The card's state from a snapshot. Unknown and DrawPending never carry a count, and a count that isn't
 * a whole number of 0 or more is dropped: a missing number is better than a wrong one.
 */
export function toActivityState(snapshot: TeamProgressSnapshot): TeamProgressState {
  const { progress } = snapshot;
  const count = progress.heatsUntil;
  const validCount = typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : null;
  return {
    status: progress.status,
    sessionId: progress.sessionId,
    heatId: progress.heatId,
    laneIndex: progress.laneIndex,
    heatsUntil: NO_COUNT.has(progress.status) ? null : validCount,
    arenaName: progress.arenaName,
    heatLabel: progress.heatLabel,
    observedAt: normaliseTime(snapshot.observedAt),
  };
}

/** The snapshot's `staleAt`, or a minute from now if it can't be read. */
export function staleAtFor(snapshot: TeamProgressSnapshot, now: Date = new Date()): string {
  return normaliseTime(snapshot.staleAt) ?? new Date(now.getTime() + FALLBACK_STALE_AFTER_MS).toISOString();
}

/**
 * Rewrites an API time as `YYYY-MM-DDTHH:mm:ss.sssZ`, the one form the Swift side parses for certain
 * (.NET can send seven fractional digits or an offset). Null if it isn't a time at all.
 */
function normaliseTime(value: string): string | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** True when an activity has run long enough that it should be ended and started again. */
export function needsRestart(activity: Pick<LiveActivitySummary, 'startedAt'>, now: Date = new Date()): boolean {
  const started = Date.parse(activity.startedAt);
  return Number.isFinite(started) && now.getTime() - started >= RESTART_AFTER_MS;
}

/** Whether Live Activities can be used here: only in the iPhone app, and only if the user allows them. */
export async function liveActivitiesEnabled(): Promise<boolean> {
  if (!isIosApp()) return false;
  try {
    return (await LiveActivity.list()).enabled;
  } catch {
    return false;
  }
}

/** Starts (or replaces) the card for a team. Returns its id, or null outside the app. */
export async function startTeamActivity(snapshot: TeamProgressSnapshot, teamName: string): Promise<string | null> {
  if (!isIosApp()) return null;
  if (endsActivity(snapshot.progress.status)) return null;
  const { activityId } = await LiveActivity.start({
    competitionId: snapshot.progress.competitionId,
    teamId: snapshot.progress.teamId,
    teamName,
    state: toActivityState(snapshot),
    staleAt: staleAtFor(snapshot),
  });
  return activityId;
}

/** Updates a team's card; Finished and Withdrawn end it with that last state. */
export async function updateTeamActivity(activityId: string, snapshot: TeamProgressSnapshot): Promise<void> {
  if (!isIosApp()) return;
  const state = toActivityState(snapshot);
  if (endsActivity(state.status)) {
    await LiveActivity.end({ activityId, state });
    return;
  }
  await LiveActivity.update({ activityId, state, staleAt: staleAtFor(snapshot) });
}

/** Ends a team's card straight away (the user stopped following). */
export async function endTeamActivity(activityId: string): Promise<void> {
  if (!isIosApp()) return;
  await LiveActivity.end({ activityId, immediately: true });
}

/** The cards running now; empty outside the app. */
export async function listTeamActivities(): Promise<LiveActivitySummary[]> {
  if (!isIosApp()) return [];
  return (await LiveActivity.list()).activities;
}
