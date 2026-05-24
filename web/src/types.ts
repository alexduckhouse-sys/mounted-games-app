export type Role = 'Admin' | 'Trainer' | 'Rider';

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  clubId: number | null;
  clubName: string | null;
  roles: Role[];
}

export interface AuthResponse {
  token: string;
  expiresAt: string;
  user: UserProfile;
}

export interface Club {
  id: number;
  name: string;
  region?: string | null;
  bibColour?: string | null;
}

export type SectionFormat = 1 | 2 | 3;
export const SectionFormatLabel: Record<SectionFormat, string> = {
  1: 'Pairs',
  2: 'Teams',
  3: 'Individual',
};

export type SessionStatus = 0 | 1 | 2;
export const SessionStatusLabel: Record<SessionStatus, string> = {
  0: 'Upcoming',
  1: 'In Arena',
  2: 'Finished',
};

export type SessionKind = 0 | 1 | 2 | 3;
export const SessionKind = {
  Race: 0 as SessionKind,
  Break: 1 as SessionKind,
  Briefing: 2 as SessionKind,
  Custom: 3 as SessionKind,
};

export type ChatMessageType = 0 | 1 | 2;

export interface CompetitionSummary {
  id: number;
  name: string;
  location?: string | null;
  startDate: string;
  endDate?: string | null;
  isActive: boolean;
  isArchived: boolean;
  sectionCount: number;
  teamCount: number;
  sessionCount: number;
}

export interface CompetitionSection {
  id: number;
  competitionId: number;
  format: SectionFormat;
  ageGroup: string;
  displayName: string;
}

export interface Team {
  id: number;
  competitionId: number;
  competitionSectionId: number;
  sectionName: string;
  clubId: number;
  clubName: string;
  suffix: string;
  displayName: string;
  bibColour?: string | null;
  trainerUserId?: string | null;
  trainerName?: string | null;
  isHorsConcours: boolean;
}

export interface HeatEntry {
  id: number;
  teamId: number;
  teamName: string;
  bibColour?: string | null;
  laneIndex: number;
}

export interface ResultRow {
  id: number;
  teamId: number;
  teamName: string;
  placing: number | null;
  eliminated: boolean;
  points: number;
}

export interface Race {
  id: number;
  heatId: number;
  name: string;
  orderIndex: number;
  isComplete: boolean;
  startedAt?: string | null;
  finishedAt?: string | null;
  results: ResultRow[];
}

export interface Heat {
  id: number;
  sessionId: number;
  label?: string | null;
  orderIndex: number;
  durationMinutes?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  entries: HeatEntry[];
  races: Race[];
}

export interface Session {
  id: number;
  competitionId: number;
  competitionSectionId: number | null;
  sectionName: string | null;
  name: string;
  arenaName?: string | null;
  scheduledStart?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  status: SessionStatus;
  orderIndex: number;
  notes?: string | null;
  isBreak: boolean;
  durationMinutes?: number | null;
  kind: SessionKind;
  location?: string | null;
  streamUrl?: string | null;
  lanesPerHeat?: number | null;
  minutesPerHeat?: number | null;
  raceOrderAlternating?: boolean;
  heats: Heat[];
}

export interface CompetitionDetail {
  id: number;
  name: string;
  location?: string | null;
  description?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  what3Words?: string | null;
  appleMapsUrl?: string | null;
  startDate: string;
  endDate?: string | null;
  isActive: boolean;
  isArchived: boolean;
  sections: CompetitionSection[];
  teams: Team[];
  sessions: Session[];
  streamUrl?: string | null;
}

export interface StandingRow {
  teamId: number;
  teamName: string;
  clubName: string;
  bibColour?: string | null;
  totalPoints: number;
  racesRun: number;
  wins: number;
  eliminations: number;
}

export interface ChatMessage {
  id: number;
  competitionId: number;
  userId?: string | null;
  authorName: string;
  body: string;
  type: ChatMessageType;
  tag?: string | null;
  createdAt: string;
}

export interface RiderEntry {
  id: number;
  savedRiderId?: number | null;
  fullName: string;
  dateOfBirth?: string | null;
  horseName?: string | null;
  bibColour?: string | null;
  isCaptain: boolean;
  isReserve: boolean;
  orderIndex: number;
}

export interface DeclarationForm {
  id: number;
  teamId: number;
  teamName: string;
  competitionId: number;
  competitionName: string;
  submittedByUserId?: string | null;
  submittedByName?: string | null;
  submittedByPhone?: string | null;
  submittedAt: string;
  notes?: string | null;
  isLocked: boolean;
  riders: RiderEntry[];
}

export interface SavedRider {
  id: number;
  clubId: number;
  fullName: string;
  dateOfBirth?: string | null;
  horseName?: string | null;
  notes?: string | null;
}

export interface TrainerNote {
  id: number;
  userId: string;
  title?: string | null;
  body: string;
  createdAt: string;
  updatedAt?: string | null;
}

export interface RaceTemplate {
  id: number;
  name: string;
  summary?: string | null;
  rules?: string | null;
  category?: string | null;
  diagramJson?: string | null;
  isBuiltIn: boolean;
}

export type DiagramElement =
  | { t: 'pole'; x: number; label?: string }
  | { t: 'cone'; x: number; label?: string }
  | { t: 'item'; x: number; label?: string }
  | { t: 'table'; x: number; label?: string }
  | { t: 'midline' };
