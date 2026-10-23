export type Role = 'Admin' | 'Trainer' | 'TrainerRequest' | 'ManagerRequest' | 'Manager' | 'Member' | 'Rider';

/** Self-service signup choices. Trainer accounts need approval from an admin or their club's manager; team managers from an admin. */
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
  /** False until the person opens the link in the confirmation email. Missing means confirmed (older accounts). */
  emailConfirmed?: boolean;
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
  /** The role they asked for. */
  requestedRole?: 'Trainer' | 'Manager';
}

/** The roles a club's people can hold, most senior first. */
export type MemberRole = 'Manager' | 'Trainer' | 'Member';

export interface ClubMember {
  userId: string;
  fullName: string;
  role: MemberRole;
  /** For a trainer: the club's teams they look after. */
  teams: string[];
  /** A team manager request for this person is waiting for an admin. */
  awaitingAdmin: boolean;
}

/** `GET /clubs/{id}/members`: everyone in the club, plus the people waiting to join it. */
export interface ClubMembers {
  clubId: number;
  clubName: string;
  members: ClubMember[];
  pending: TrainerRequest[];
}

/** `PUT /clubs/{id}/members/{userId}/role`: `awaitingAdmin` means nothing changed yet, an admin has to approve. */
export interface ClubRoleChange {
  role: MemberRole;
  awaitingAdmin: boolean;
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

/** How an age group settles teams level on points at a finals cut-off or on the podium. 0 Countback, 1 LastRace, 2 RunOff, 3 Manual. */
export type TieBreakRule = 0 | 1 | 2 | 3;
export const TieBreakRule = {
  Countback: 0 as TieBreakRule,
  LastRace: 1 as TieBreakRule,
  RunOff: 2 as TieBreakRule,
  Manual: 3 as TieBreakRule,
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
  /** A sample event: its payments are tests only. */
  isDemo?: boolean;
  /** Taking entries: not locked, and it has age groups to enter. */
  entriesOpen?: boolean;
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
  /** How teams level on points are settled; missing means countback. */
  tieBreakRule?: TieBreakRule;
  /** How many teams go through to the final, set by the organiser; null when not set. */
  finalistCount?: number | null;
  usesRaceFinals?: boolean;
  priceMinor?: number;
  /** Cap on active signups (null/undefined = unlimited). */
  maxParticipants?: number | null;
  /** Paid and pending entries, the ones that take a seat. Public, so everyone sees the real seats left. */
  activeSignupsCount?: number;
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
  /** "trainer", "manager" (of the team's club), "supporter" or null — only set on /trainer/my-teams. */
  relationship?: 'trainer' | 'manager' | 'supporter' | null;
  /** Join key — set only when the viewer is the trainer or the club's manager. */
  supporterJoinKey?: string | null;
  /** Withdrawn or no-show. Public; the reason is organiser-only. */
  isWithdrawn?: boolean;
  /** What the team's bibs look like, in plain words. One description for the whole team. */
  bibDescription?: string | null;
  /** Only on `/trainer/my-teams`: the viewer fills in this team's dec form, the event isn't over, and none is in yet. */
  needsDeclaration?: boolean | null;
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
  /** The team had no lane this race (more teams than lanes) and sat it out. Shown as S. */
  isSitOut?: boolean;
  /** Why a team that did not finish (eliminated is true) did not: 1 E, 2 DNS, 3 DNF, 4 R. Missing on older data, meaning E. */
  status?: number;
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
  /** How teams change lane after each race: 0 move up one (the default), 1 stay, 2 move down one. */
  laneRotationMode?: 0 | 1 | 2;
  /** Heat-heat-final: how many teams go through from each qualifier to the final (3 when unset). */
  qualifiersPerHeat?: number | null;
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
  /** A sample event: its payments are tests only. */
  isDemo?: boolean;
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
/** Entry confirmation email: NotRequested / Sent / Failed / NotSent (sending is off on the server). */
export type EmailDeliveryStatus = 0 | 1 | 2 | 3;

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
  /** Staff-only: the adult's address and whether the confirmation email went. */
  contactEmail?: string | null;
  confirmationEmailStatus?: EmailDeliveryStatus;
  confirmationEmailAt?: string | null;
  /** A custom team name; riders who share one form a team of that name. */
  teamName?: string | null;
  /** A team manager or trainer entering a whole team in one go. */
  isWholeTeam?: boolean;
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
  /** 0 for the A Final, 1 for the B Final and so on; null when the team is in no lettered final. */
  finalTier?: number | null;
  /** Scored points stand, but the team is out of the rest of the event. */
  withdrawn?: boolean;
  /** Tack check bonus points, already included in `totalPoints`. */
  bonusPoints?: number;
}

/** Matches `TackCheckMode`: 0 pass or fail only, 1 a separate Tack & Turnout table, 2 bonus points in the standings. */
export type TackCheckMode = 0 | 1 | 2;

export interface TackCheckSector { id: number; name: string }
export interface TackCheckMark { sectorId: number; passed: boolean | null; points: number | null }

export interface TackCheckTeam {
  teamId: number;
  teamName: string;
  clubName: string;
  isHorsConcours: boolean;
  withdrawn: boolean;
  marks: TackCheckMark[];
  total: number;
  passed: number;
  failed: number;
}

export interface TackCheckSection {
  sectionId: number;
  sectionName: string;
  /** False until the organiser saves a set-up; the sectors are then the defaults, with id 0. */
  configured: boolean;
  isEnabled: boolean;
  mode: TackCheckMode;
  maxPoints: number;
  sectors: TackCheckSector[];
  teams: TackCheckTeam[];
}

export interface TackCheckBoard { competitionId: number; sections: TackCheckSection[] }

export interface TackLeaderboardRow {
  /** Shared by teams level on points; null for hors concours teams, listed last. */
  rank: number | null;
  teamId: number;
  teamName: string;
  clubName: string;
  points: (number | null)[];
  total: number;
  isHorsConcours: boolean;
}

export interface TackLeaderboardSection {
  sectionId: number;
  sectionName: string;
  mode: TackCheckMode;
  maxPoints: number;
  sectors: string[];
  rows: TackLeaderboardRow[];
}

export interface TackLeaderboard { sections: TackLeaderboardSection[] }

export interface PassportCheckPony { ponyName: string; riders: string[]; checkedAt: string | null; checkedByName: string | null }

export interface PassportCheckTeam {
  teamId: number;
  teamName: string;
  clubName: string;
  withdrawn: boolean;
  isHorsConcours: boolean;
  hasDeclaration: boolean;
  ponies: PassportCheckPony[];
}

export interface PassportCheckBoard {
  enabled: boolean;
  checked: number;
  total: number;
  sections: { sectionId: number; sectionName: string; teams: PassportCheckTeam[] }[];
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
  /** Private message to the organisers: only admins and its author see it (and the recipient of an organiser's reply). */
  adminOnly: boolean;
  /** For an organiser's private reply: the person whose thread it answers. */
  recipientUserId?: string | null;
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
  /** A guest rider borrowed from outside the team. */
  isGuestRider?: boolean;
  orderIndex: number;
  /** Public pages get the name already shortened; staff and the owning trainer see the choice. */
  useInitialOnly?: boolean;
  /** Only sent to the owning trainer and staff. */
  noFilming?: boolean;
  /** The pony's height in hands, written as a decimal: 13.2 is 13 hands 2 inches. */
  ponyHeightHands?: number | null;
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
  /** The team's bib description, shown with the declaration. */
  bibDescription?: string | null;
  /** The coach as typed on the form. Only the submitter, the trainer and staff get it. */
  trainerName?: string | null;
  /** When the terms were agreed; missing on forms from before the tick. Private like the rest. */
  termsAcceptedAt?: string | null;
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
  ponyHeightHands?: number | null;
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
 * Positions are slots on the lane (see components/diagramSlots.ts): `anchor`
 * holds the slot id (`start`, `pole1`, `gap2`, `top`, `beyond`) and `x` is
 * derived from it. Older diagrams with free `x` or anchor + offset are mapped
 * to the nearest slot when read.
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
  | { t: 'midline' }
  /** Lane layout: how many bending poles the slot grid has (see diagramSlots.ts). */
  | { t: 'lane'; poles?: number };

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
  /** Sponsor cards over the video: Auto shows them during breaks and briefings, On always, Off never. */
  sponsorMode: OverlayMode;
  /** The event's look, stored as the web app's own JSON. Read it with `parseLook`. */
  look: unknown;
  revision: number;
  updatedAt: string | null;
}

/** A scorer link as the organiser sees it (`/competitions/{id}/scorer-links`). The token is never part of it. */
export interface ScorerLink {
  id: number;
  label: string;
  arenaName: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}
export interface ScorerLinkList { arenas: string[]; defaultExpiresAt: string; links: ScorerLink[] }
/** The reply to creating a link. `token` and `path` are shown once and never returned again. */
export interface CreatedScorerLink { link: ScorerLink; token: string; path: string }
/** What a scorer link holder gets: their arena's timetable and nothing else. */
export interface ScorerSession {
  label: string;
  competitionId: number;
  competitionName: string;
  arenaName: string;
  expiresAt: string;
  sessions: Session[];
}

/** 0 headline, 1 major, 2 supporter. */
export type SponsorTier = 0 | 1 | 2;

/** A sponsor that is on show now, as every viewer gets it. `showOn` is a set of `SPONSOR_PLACEMENTS` bits. */
export interface Sponsor {
  id: number;
  name: string;
  /** An https address, or null. */
  linkUrl: string | null;
  /** A path on the API, ending in the logo's version; null when there is no logo. */
  logoUrl: string | null;
  tier: SponsorTier;
  sortOrder: number;
  showOn: number;
}

/** A sponsor as the organisers see it. */
export interface SponsorAdmin extends Sponsor {
  isEnabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
  /** Times shown, and seconds on screen (video), over all places and days. */
  views: number;
  seconds: number;
}

/** What a statistics profile is about: 0 rider, 1 pony, 2 team, 3 club (`StatsSubjectKind` in the API). */
export type StatsSubjectKind = 0 | 1 | 2 | 3;
export const StatsSubjectKind = {
  Rider: 0 as StatsSubjectKind,
  Pony: 1 as StatsSubjectKind,
  Team: 2 as StatsSubjectKind,
  Club: 3 as StatsSubjectKind,
};

/** A search result. `key` is what the profile endpoint takes as `name`. */
export interface StatsHit {
  kind: StatsSubjectKind;
  name: string;
  key: string;
  /** Finished competitions that count towards the profile. */
  competitions: number;
}

/** One page of the browse list for a kind; `total` counts everything matching `query`. */
export interface StatsBrowse {
  kind: StatsSubjectKind;
  query: string;
  page: number;
  pageSize: number;
  total: number;
  items: StatsHit[];
}

export interface StatsSummary {
  competitions: number;
  entries: number;
  /** Entries with a final place (hors concours teams have none). */
  placedEntries: number;
  firsts: number;
  seconds: number;
  thirds: number;
  averagePlace: number | null;
  /** Placed entries in an age group that ran lettered finals. */
  entriesWithFinals: number;
  finalsReached: number;
  aFinals: number;
  aFinalPercent: number | null;
  races: number;
  wins: number;
  winPercent: number | null;
  points: number;
  maxPoints: number;
  pointQuotaPercent: number | null;
}

export interface StatsGame {
  name: string;
  races: number;
  wins: number;
  winPercent: number | null;
  /** Eliminated, did not start, did not finish or retired. */
  nonFinishes: number;
  points: number;
  maxPoints: number;
  pointQuotaPercent: number | null;
}

export interface StatsSession {
  sessionId: number;
  name: string;
  points: number;
  maxPoints: number;
  /** Null for a hors concours team. */
  rank: number | null;
  teams: number;
}

export interface StatsEntry {
  competitionId: number;
  competitionName: string;
  startDate: string;
  sectionId: number;
  sectionName: string;
  format: SectionFormat;
  teamId: number;
  teamName: string;
  clubName: string;
  isHorsConcours: boolean;
  riderName: string | null;
  ponyName: string | null;
  place: number | null;
  teamsPlaced: number;
  /** 0 for the A Final, 1 for the B Final, and so on. */
  finalTier: number | null;
  races: number;
  points: number;
  maxPoints: number;
  pointQuotaPercent: number | null;
  sessions: StatsSession[];
}

export interface StatsPartnership {
  riderName: string;
  ponyName: string;
  entries: number;
  competitions: number;
}

/** Everyone gets `summary`; the lists are null unless the viewer is signed in (`detailed`). */
export interface StatsProfile {
  kind: StatsSubjectKind;
  name: string;
  key: string;
  detailed: boolean;
  /** False for riders and ponies: their race and game figures come from individual and pairs competitions only. */
  raceFiguresAllFormats: boolean;
  summary: StatsSummary;
  games: StatsGame[] | null;
  bestGames: string[] | null;
  worstGames: string[] | null;
  entries: StatsEntry[] | null;
  partnerships: StatsPartnership[] | null;
}
