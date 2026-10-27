import type { Session } from '../types';

export type SessionResultVerificationStatus =
  | 'in-progress'
  | 'provisional'
  | 'under-review-hold'
  | 'official';

export interface SessionProvisionalState {
  status: SessionResultVerificationStatus;
  isProvisional: boolean;
  isOfficial: boolean;
  hasUnderReview: boolean;
  remainingSeconds: number;
  remainingMinutes: number;
  provisionalUntilIso: string | null;
  officialConfirmedAtIso: string | null;
  badgeText: string | null;
}

export const DEFAULT_PROVISIONAL_MINUTES = 15;

function parseUtcMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const normalized = /Z|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? null : ms;
}

export function sessionHasUnderReviewResult(session: Pick<Session, 'heats'>): boolean {
  return session.heats.some((heat) =>
    heat.races.some((race) =>
      race.results.some((res) => Boolean(res.underReview)),
    ),
  );
}

/**
 * Computes whether a finished session is still inside its 15-minute provisional query window,
 * held open because a race result is flagged `[under-review]`, or confirmed as Official.
 */
export function getSessionProvisionalState(
  session: Pick<Session, 'status' | 'finishedAt' | 'provisionalUntil' | 'officialConfirmedAt' | 'heats'>,
  nowMs: number = Date.now(),
): SessionProvisionalState {
  const hasUnderReview = sessionHasUnderReviewResult(session);

  if (session.status !== 2) {
    return {
      status: 'in-progress',
      isProvisional: false,
      isOfficial: false,
      hasUnderReview,
      remainingSeconds: 0,
      remainingMinutes: 0,
      provisionalUntilIso: session.provisionalUntil ?? null,
      officialConfirmedAtIso: session.officialConfirmedAt ?? null,
      badgeText: hasUnderReview ? 'Result under review' : null,
    };
  }

  const confirmedMs = parseUtcMs(session.officialConfirmedAt);
  const explicitUntilMs = parseUtcMs(session.provisionalUntil);
  const finishedMs = parseUtcMs(session.finishedAt);
  const effectiveUntilMs =
    explicitUntilMs ??
    (finishedMs !== null ? finishedMs + DEFAULT_PROVISIONAL_MINUTES * 60_000 : null);

  const remainingSeconds =
    effectiveUntilMs !== null && effectiveUntilMs > nowMs
      ? Math.ceil((effectiveUntilMs - nowMs) / 1000)
      : 0;
  const remainingMinutes = remainingSeconds > 0 ? Math.max(1, Math.ceil(remainingSeconds / 60)) : 0;

  if (hasUnderReview) {
    return {
      status: 'under-review-hold',
      isProvisional: true,
      isOfficial: false,
      hasUnderReview: true,
      remainingSeconds,
      remainingMinutes,
      provisionalUntilIso: session.provisionalUntil ?? null,
      officialConfirmedAtIso: session.officialConfirmedAt ?? null,
      badgeText: 'Provisional · Result under review',
    };
  }

  if (confirmedMs !== null && (explicitUntilMs === null || confirmedMs >= explicitUntilMs || remainingSeconds === 0)) {
    return {
      status: 'official',
      isProvisional: false,
      isOfficial: true,
      hasUnderReview: false,
      remainingSeconds: 0,
      remainingMinutes: 0,
      provisionalUntilIso: session.provisionalUntil ?? null,
      officialConfirmedAtIso: session.officialConfirmedAt ?? null,
      badgeText: 'Official',
    };
  }

  if (remainingSeconds > 0) {
    return {
      status: 'provisional',
      isProvisional: true,
      isOfficial: false,
      hasUnderReview: false,
      remainingSeconds,
      remainingMinutes,
      provisionalUntilIso: session.provisionalUntil ?? null,
      officialConfirmedAtIso: session.officialConfirmedAt ?? null,
      badgeText: `Provisional · ${remainingMinutes}m left for queries`,
    };
  }

  return {
    status: 'official',
    isProvisional: false,
    isOfficial: true,
    hasUnderReview: false,
    remainingSeconds: 0,
    remainingMinutes: 0,
    provisionalUntilIso: session.provisionalUntil ?? null,
    officialConfirmedAtIso: session.officialConfirmedAt ?? null,
    badgeText: 'Official',
  };
}

/**
 * Summarises the provisional/official state across all finished race sessions for a section (or competition).
 */
export function getSectionProvisionalState(
  sessions: readonly Session[],
  sectionId?: number | null,
  nowMs: number = Date.now(),
): SessionProvisionalState | null {
  const relevant = sessions.filter(
    (s) =>
      !s.isBreak &&
      s.kind === 0 &&
      s.status === 2 &&
      (sectionId == null || s.competitionSectionId === sectionId),
  );
  if (relevant.length === 0) return null;

  const states = relevant.map((s) => getSessionProvisionalState(s, nowMs));
  const underReview = states.find((st) => st.status === 'under-review-hold');
  if (underReview) return underReview;

  const provisional = states
    .filter((st) => st.status === 'provisional')
    .sort((a, b) => b.remainingSeconds - a.remainingSeconds)[0];
  if (provisional) return provisional;

  return states[states.length - 1];
}
