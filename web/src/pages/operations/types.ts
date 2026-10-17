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

export interface Rulebook {
  id: number;
  competitionId: number;
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

export function apiMessage(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: { message?: string; title?: string } | string } })?.response?.data;
  if (typeof data === 'string' && data.trim()) return data;
  if (data && typeof data === 'object') return data.message ?? data.title ?? fallback;
  return fallback;
}
