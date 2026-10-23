export interface DrawTeamAssignment {
  teamId: number;
  teamName: string;
  laneIndex: number;
}

export interface DrawHeat {
  heatId: number;
  label: string | null;
  orderIndex: number;
  teams: DrawTeamAssignment[];
}

export interface DrawSession {
  sessionId: number;
  name: string;
  heats: DrawHeat[];
}

export interface DrawPreview {
  sectionId: number;
  seed: number;
  fingerprint: string;
  sessions: DrawSession[];
  fairness: {
    teamCount: number;
    sessionCount: number;
    heatSizeSpread: number;
    maximumOpponentMeetings: number;
    repeatedOpponentPairs: number;
    maximumLaneUseSpread: number;
    everyTeamAppearsOncePerSession: boolean;
    warnings: string[];
  };
}

export interface EquipmentChecklistItem {
  key: string;
  kind: string;
  bucket: string;
  count: number;
  acknowledged: boolean;
  acknowledgedAt: string | null;
}

export interface CompetitionReadiness {
  competitionId: number;
  isReady: boolean;
  equipmentFingerprint: string;
  missingDeclarations: Array<{ teamId: number; teamName: string; sectionId: number; sectionName: string }>;
  unpaidSignups: Array<{ signupId: number; sectionId: number; sectionName: string; amountMinor: number }>;
  incompleteTeams: Array<{
    teamId: number;
    teamName: string;
    sectionId: number;
    sectionName: string;
    declaredRiders: number;
    minimumRiders: number;
  }>;
  sessionOverlaps: Array<{
    firstSessionId: number;
    firstSessionName: string;
    secondSessionId: number;
    secondSessionName: string;
    arena: string;
    startsAt: string;
    endsAt: string;
  }>;
  equipmentChecklist: EquipmentChecklistItem[];
  equipmentIssues: Array<{ raceName: string; message: string }>;
}

/** A list entry: the text is fetched separately when the rulebook is opened. */
export interface RulebookSummary {
  id: number;
  title: string;
  edition: string;
  sourceUrl: string | null;
  updatedAt: string;
}

export interface Rulebook {
  id: number;
  title: string;
  edition: string;
  sourceUrl: string | null;
  text: string;
  updatedAt: string;
}

export type RaceScoreEventKind = 1 | 2 | 3 | 4;

export interface ScorePlace {
  teamId: number;
  place: number;
  eliminated: boolean;
  points: number;
  /** Why the team did not finish: 1 E, 2 DNS, 3 DNF, 4 R. Missing on old history entries. */
  status?: number;
  /** The referee's private note. Staff-only reads only. */
  refereeNote?: string | null;
}

export interface RaceScore {
  raceId: number;
  revision: number;
  isSignedOff: boolean;
  signedOffAt: string | null;
  signedOffByUserId: string | null;
  results: ScorePlace[];
  idempotentReplay: boolean;
}

export interface RaceScoreHistory {
  revision: number;
  kind: RaceScoreEventKind;
  before: ScorePlace[];
  after: ScorePlace[];
  actorUserId: string | null;
  reason: string;
  createdAt: string;
}

/** 0 in the draw, 1 withdrawn, 2 no-show. */
export type TeamEntryStatus = 0 | 1 | 2;

export interface TeamEntry {
  teamId: number;
  teamName: string;
  sectionId: number;
  sectionName: string;
  isHorsConcours: boolean;
  status: TeamEntryStatus;
  reason: string | null;
  changedAt: string | null;
  canReinstate: boolean;
  redrawAvailable: boolean;
}

export interface SetTeamEntryStatusResult {
  team: TeamEntry;
  heatPlacesChanged: number;
  changedSessionIds: number[];
}

export interface RedrawMove {
  teamId: number;
  teamName: string;
  fromHeatId: number | null;
  toHeatId: number | null;
}

export interface RedrawSession {
  sessionId: number;
  name: string;
  protectedHeats: number;
  before: DrawHeat[];
  after: DrawHeat[];
  removedHeatIds: number[];
  moves: RedrawMove[];
}

export interface RedrawPreview {
  sectionId: number;
  fingerprint: string;
  hasChanges: boolean;
  outTeams: Array<{ teamId: number; teamName: string; status: TeamEntryStatus }>;
  sessions: RedrawSession[];
  notes: string[];
  replayed: boolean;
}

export interface RiderSnapshot {
  riderEntryId: number;
  fullName: string;
  isReserve: boolean;
  isCaptain: boolean;
  orderIndex: number;
}

export interface RiderSwap {
  id: number;
  declarationFormId: number;
  teamId: number;
  outRiderEntryId: number;
  inRiderEntryId: number;
  before: RiderSnapshot[];
  after: RiderSnapshot[];
  actorUserId: string | null;
  reason: string;
  overrodeLock: boolean;
  createdAt: string;
  replayed: boolean;
}

/** A fresh id for one attempt at a write, reused when the same attempt is retried. */
export function newRequestId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  return c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function statusOf(error: unknown): number | undefined {
  return (error as { response?: { status?: number } })?.response?.status;
}

/** True when the request never reached the server, so the user should retry rather than correct anything. */
export function isOffline(error: unknown): boolean {
  return (error as { response?: unknown })?.response === undefined;
}

export function apiMessage(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: { message?: string; title?: string } | string } })?.response?.data;
  if (typeof data === 'string' && data.trim()) return data;
  if (data && typeof data === 'object') return data.message ?? data.title ?? fallback;
  return fallback;
}
