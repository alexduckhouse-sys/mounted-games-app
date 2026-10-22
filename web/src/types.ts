export type Role = 'Admin' | 'Trainer' | 'TrainerRequest' | 'Manager' | 'Member' | 'Rider';

/** Self-service signup choices. Trainer accounts need admin approval. */
export const SIGNUP_ROLES: { value: 'Trainer' | 'Manager' | 'Member'; label: string; description: string }[] = [
  { value: 'Trainer', label: 'Trainer', description: 'Coach your pony club\'s teams; submit dec forms.' },
  { value: 'Manager', label: 'Team manager', description: 'Run the team\'s admin side: dec forms, contact, signups.' },
  { value: 'Member', label: 'Pony Club member', description: 'Follow your club\'s teams; see dec forms.' },
];

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  clubId: number | null;
  clubName: string | null;
  roles: Role[];
}

/** One competition the signed-in user owns (`owner`) or is a competition admin of. */
export interface CompetitionAccess {
  competitionId: number;
  owner: boolean;
}

/** A competition admin: can do everything the owner can for that one event. */
export interface CompetitionHelper {
  userId: string;
  name: string;
  email: string;
  addedAt: string;
}

export interface CompetitionTeam {
  owner: { userId: string; name: string } | null;
  helpers: CompetitionHelper[];
}

export interface AuthResponse {
  token: string;
  expiresAt: string;
  user: UserProfile;
}

export interface TrainerRequest {
  userId: string;
  fullName: string;
  email: string | null;
  clubName: string | null;
  requestedAt: string;
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

export interface CompetitionPickerItem {
  id: number;
  name: string;
  startDate: string;
  endDate: string | null;
  icon: string;
  location?: string | null;
  ageGroupCount?: number;
  live?: { sectionName?: string | null; heatLabel: string; arenaName?: string | null } | null;
}

export interface CompetitionPickerPage {
  items: CompetitionPickerItem[];
  hasMore: boolean;
}

export interface CompetitionSection {
  id: number;
  competitionId: number;
  format: SectionFormat;
  ageGroup: string;
  displayName: string;
  runoffRaceName?: string | null;
  /** How many teams go through to the final, set by the organiser; null when not set. */
  finalistCount?: number | null;
  usesRaceFinals?: boolean;
  priceMinor?: number;
  /** Cap on active signups (null/undefined = unlimited). */
  maxParticipants?: number | null;
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
  createdByUserId?: string | null;
  icon?: string;
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
  /** Explicit capability from APIs that keep trainer messages private. Missing means unavailable. */
  staffChatEnabled?: boolean;
  /** The organiser's terms and conditions as plain text; empty means the sign-up form shows a placeholder. */
  termsText?: string | null;
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
  useInitialOnly?: boolean;
  noFilming?: boolean;
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
  /** Trainer message: only admins and its author see it. */
  adminOnly: boolean;
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
  /** Public pages get the name already shortened; staff and the owning trainer see the choice. */
  useInitialOnly?: boolean;
  /** Only sent to the owning trainer and staff. */
  noFilming?: boolean;
}

/** A heat holding a rider who opted out of close-up filming. Staff only. */
export interface FilmingOptOut {
  heatId: number;
  sessionId: number;
  sessionName: string;
  arenaName?: string | null;
  heatLabel: string;
  teamId: number;
  teamName: string;
  lane: number;
  riderName: string;
  isReserve: boolean;
  heatFinished: boolean;
  sessionOrder: number;
  heatOrder: number;
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
  useInitialOnly?: boolean;
  noFilming?: boolean;
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

export type LiveStreamStatus = 0 | 1 | 2;
export interface LiveStream {
  id: number;
  competitionId: number;
  arenaName: string;
  angleName: string;
  status: LiveStreamStatus;
  caption: string | null;
  audioMuted: boolean;
  hasAudio: boolean;
  startedAt: string;
  viewerCount: number;
  generation: number;
}
export interface IceServer { urls: string | string[]; username?: string; credential?: string }
export interface LiveStreamsResponse { enabled: boolean; streams: LiveStream[] }
export interface PublishRequest { sdpOffer: string; videoMid: string; audioMid?: string | null }
export interface StartStreamRequest extends PublishRequest { arenaName: string; angleName: string; takeOver?: boolean }
export interface PublishResponse { streamId: number; attempt: number; sdpAnswer: string }
export interface ReadyRequest { attempt: number }
export interface UpdateStreamRequest { status?: 0 | 1; audioMuted?: boolean; caption?: string | null }

/** 0 ticker, 1 lower bar, 2 alert. */
export type OverlayBannerStyle = 0 | 1 | 2;
/** 0 auto (follows the timetable or results), 1 always on, 2 off. */
export type OverlayMode = 0 | 1 | 2;

/** What viewers see over a competition's live video (`/competitions/{id}/overlays`). */
export interface StreamOverlay {
  bannerText: string | null;
  bannerStyle: OverlayBannerStyle;
  /** Arenas the banner shows in; empty means every arena. */
  bannerArenas: string[];
  stripMode: OverlayMode;
  scoreCardMode: OverlayMode;
  scoreCardDelaySeconds: number;
  scoreCardSeconds: number;
  /** The event's look, stored as the web app's own JSON. Read it with `parseLook`. */
  look: unknown;
  revision: number;
  updatedAt: string | null;
}
