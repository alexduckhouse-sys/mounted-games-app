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
  runoffRaceName?: string | null;
  usesRaceFinals?: boolean;
  priceMinor?: number;
}

export type RaceRoundStage = 0 | 1 | 2; // None / Qualifier / Final

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
  /** "trainer", "supporter" or null — only set on /trainer/my-teams. */
  relationship?: 'trainer' | 'supporter' | null;
  /** Join key — set only when the viewer is the trainer of this team. */
  supporterJoinKey?: string | null;
}

export type TeamSupporterStatus = 0 | 1; // Pending / Accepted

export interface TeamSupporter {
  id: number;
  teamId: number;
  teamName: string;
  userId: string;
  userName: string;
  userEmail?: string | null;
  status: TeamSupporterStatus;
  createdAt: string;
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
  scheduledStart?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  raceRoundId?: number | null;
  raceRoundStage?: RaceRoundStage;
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
  organiserName?: string | null;
  paymentDestination?: string | null;
  /** When true the public signup form is hidden and the API rejects new signups. */
  signupsLocked?: boolean;
}

export interface MySignup {
  id: number;
  competitionId: number;
  competitionName: string;
  competitionStart: string;
  competitionSectionId: number;
  sectionName: string;
  fullName: string;
  ponyClubName?: string | null;
  contactInfo?: string | null;
  amountMinor: number;
  status: SignupPaymentStatus;
  paidAt?: string | null;
  teamId?: number | null;
  teamName?: string | null;
  createdAt: string;
}

export interface FormedTeamPreview {
  clubName: string;
  clubId: number;
  suffix: string;
  signupIds: number[];
  riderNames: string[];
}

export interface FormTeamsResult {
  preview: boolean;
  ridersPerTeam: number;
  paidSignups: number;
  teams: FormedTeamPreview[];
  created: Team[];
}

export type SignupPaymentStatus = 0 | 1 | 2 | 3; // Pending / Paid / Refunded / Cancelled

export interface SectionSignup {
  id: number;
  competitionSectionId: number;
  sectionName: string;
  fullName: string;
  ponyClubName?: string | null;
  contactInfo?: string | null;
  amountMinor: number;
  status: SignupPaymentStatus;
  paidAt?: string | null;
  teamId?: number | null;
  createdAt: string;
}

export interface ShopPost {
  id: number;
  authorName: string;
  ponyClubName?: string | null;
  authorUserId?: string | null;
  title: string;
  body: string;
  priceMinor?: number | null;
  contactInfo?: string | null;
  imageBase64?: string | null;
  createdAt: string;
  isDeleted: boolean;
  commentCount: number;
  reportCount: number;
}

export interface ShopComment {
  id: number;
  postId: number;
  authorUserId?: string | null;
  authorName: string;
  body: string;
  isPrivate: boolean;
  toUserId?: string | null;
  createdAt: string;
}

export interface EquipmentLine {
  kind: string;
  bucket: string;
  count: number;
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

export interface StewardCall {
  id: number;
  raceId: number;
  heatId: number;
  competitionId: number;
  teamId: number;
  teamName: string;
  teamBibColour?: string | null;
  laneIndex: number;
  reporterName?: string | null;
  createdAt: string;
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

/**
 * Where an element sits along the lane.
 * - `x` is an absolute percentage 0-100 (Start at 0, Finish at 100).
 * - `anchor` references a named landmark resolved at render time:
 *   `pole1`, `pole2`, … `poleN` (the Nth pole in the elements array),
 *   `start`, `finish`, `midline`, `changeover`.
 * - `offset` is an optional displacement in percentage units added to the anchor.
 * If both `x` and `anchor` are given, anchor wins.
 *
 * `on` is a stack of equipment placed ON this element (mug on a pole,
 * tennis ball on a mug, etc). Renderer draws each level above the previous.
 *
 * `label` is the human-readable name for the element ("Mug", "EGUK flag", …).
 */
/** Equipment kind discriminator for `cone` and `item` elements. */
export type ConeKind = 'flag' | 'ball';
export type ItemKind =
  | 'bucket' | 'bin' | 'mug' | 'ball' | 'flag' | 'sock' | 'sack'
  | 'baton' | 'sword' | 'quoit' | 'card' | 'penny' | 'bottle' | 'box';

export interface DiagramPos {
  x?: number;
  anchor?: string;
  offset?: number;
  label?: string;
  /** Visual subtype — `cone` defaults to a flag-style cone; `item` defaults
   * to a generic equipment square. Ignored on pole/midline. */
  kind?: ConeKind | ItemKind;
  on?: DiagramElement[];
}

export type DiagramElement =
  | ({ t: 'pole' } & DiagramPos)
  | ({ t: 'cone' } & DiagramPos)
  | ({ t: 'item' } & DiagramPos)
  | ({ t: 'in' } & DiagramPos)
  /** Legacy alias for `in` — both names render identically. */
  | ({ t: 'table' } & DiagramPos)
  | { t: 'midline' };

/** All placeable shape types exposed in the diagram editor toolbar. */
export interface DiagramTool {
  t: DiagramElement['t'];
  kind?: ConeKind | ItemKind;
  label: string;
}

export const DIAGRAM_TOOLS: DiagramTool[] = [
  { t: 'pole', label: 'Pole' },
  { t: 'cone', kind: 'flag', label: 'Flag cone' },
  { t: 'cone', kind: 'ball', label: 'Ball cone' },
  { t: 'in', label: 'In / station' },
  { t: 'item', kind: 'bucket', label: 'Bucket' },
  { t: 'item', kind: 'bin', label: 'Bin' },
  { t: 'item', kind: 'mug', label: 'Mug' },
  { t: 'item', kind: 'ball', label: 'Ball' },
  { t: 'item', kind: 'flag', label: 'Flag' },
  { t: 'item', kind: 'sock', label: 'Sock' },
  { t: 'item', kind: 'sack', label: 'Sack' },
  { t: 'item', kind: 'bottle', label: 'Bottle' },
  { t: 'item', kind: 'baton', label: 'Baton' },
  { t: 'item', kind: 'sword', label: 'Sword' },
  { t: 'item', kind: 'quoit', label: 'Quoit' },
  { t: 'item', kind: 'card', label: 'Card' },
  { t: 'item', kind: 'penny', label: 'Penny' },
  { t: 'item', kind: 'box', label: 'Box' },
];
