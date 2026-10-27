export type Role = 'Admin' | 'MasterAdmin' | 'Trainer' | 'TrainerRequest' | 'ManagerRequest' | 'Manager' | 'Member' | 'Rider';

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
  /** False when the address on the account has not been confirmed yet. Missing means confirmed. */
  emailConfirmed?: boolean;
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

/** A password reset link (`PasswordResetLinkState`): 0 usable, 1 expired or replaced by a newer link, 2 already used, 3 not valid. */
export type PasswordResetLinkState = 0 | 1 | 2 | 3;

/** `POST /api/auth/password-reset/check`. Says nothing about whose account the link is for. */
export interface PasswordResetCheck {
  state: PasswordResetLinkState;
  /** Only for a usable link. */
  expiresAt: string | null;
}

/** The body of a refused `POST /api/auth/password-reset/confirm` (400, 404 or 410). */
export interface PasswordResetProblem {
  code: 'expired' | 'used' | 'invalid' | 'conflict' | 'failed' | 'password_rules' | 'password_required';
  message: string;
  /** Friendly wording per broken password rule, with Identity's codes in `errorCodes`. Only for `password_rules`. */
  errors?: string[] | null;
  errorCodes?: string[] | null;
}

/** A sign-in provider switched on in the API (`GET /auth/providers`). `clientId` is the public web client ID. */
export interface ExternalProvider {
  id: 'google' | 'apple';
  name: string;
  clientId: string;
}

export interface ExternalAuthResponse {
  needsSignup: boolean;
  auth: AuthResponse | null;
  email?: string | null;
  suggestedName?: string | null;
  provider?: string | null;
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
  /** Sessions that have heats: the timetable is exact for these. Older API responses leave it out. */
  heatedSessionCount?: number;
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
  years?: number[] | null;
  locations?: string[] | null;
  items: CompetitionPickerItem[];
  hasMore: boolean;
}

/** `GET /api/competitions/picker/near-you`: the upcoming list ordered for this viewer. Never cached or shared. */
export interface CompetitionNearYouPage {
  items: CompetitionPickerItem[];
  hasMore: boolean;
  /** We could tell roughly where the viewer is (without asking). When false there are no distances and no toggle. */
  locationKnown: boolean;
  /** The order used: nearest first, or soonest first. */
  sort: 'nearest' | 'soonest';
  /** Whole miles from the viewer, for the items on this page that have a known venue. */
  distances: { id: number; miles: number }[];
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
  /** Standard format only (heat, heat, final ignores these three). The section ends with a finals session; missing means yes. */
  hasFinal?: boolean;
  /** A finalist's earlier points add to its final score in the standings; off means the final is scored on its own. Missing means off. */
  carryPointsIntoFinal?: boolean;
  /** Final race points count double. Fixed once a final race has been scored. Missing means off. */
  doublePointsInFinal?: boolean;
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
  /** The team's current disciplinary card, if staff gave one. */
  refereeCard?: 'yellow' | 'red' | null;
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
  /** The team's current disciplinary card ('yellow' or 'red'), or none. Set by staff on the scoring screen. */
  refereeCard?: 'yellow' | 'red' | null;
  flag?: string | null;
  bibDescription?: string | null;
  /** Heat-specific spare bib colour when two teams in the heat share the same usual bib colour. */
  bibColourOverride?: string | null;
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
  refereeCard?: 'yellow' | 'red' | null;
  underReview?: boolean;
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

export type ReplayRaceMarker = Pick<Race, 'id' | 'name' | 'orderIndex' | 'startedAt' | 'finishedAt' | 'isComplete'>;

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
  /** The races chosen for each heat before any heat exists (the competition creator); null when not chosen. */
  plannedRaces?: string[] | null;
  /** Finals sessions: the B, C... finals' own race lists, keyed by final letter; a final without one uses `plannedRaces`. */
  plannedFinalRaces?: Record<string, string[]> | null;
  /** UTC timestamp until which a finished session's results remain in their 15-minute provisional query window. */
  provisionalUntil?: string | null;
  /** UTC timestamp when competition staff explicitly confirmed the session's results as official. */
  officialConfirmedAt?: string | null;
  heats: Heat[];
}

export type GateCheckStatus = 'at-gate' | 'warming-up' | 'missing' | null;

export interface UpdateGateCheckRequest {
  teamId: number;
  status: GateCheckStatus;
}

export type ArenaAssistanceService = 'farrier' | 'vet' | 'first-aid';

export interface RequestArenaAssistanceRequest {
  service: ArenaAssistanceService;
  arenaName?: string | null;
  note?: string | null;
  holdArena?: boolean;
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
  /** The venue's postcode, upper-cased. Null when the organiser hasn't given one. */
  postcode?: string | null;
  /** The governing body's number for the competition. */
  competitionNumber?: string | null;
  /** Where entrants write to the organiser. Shown on the public Details tab. */
  contactEmail?: string | null;
  /** Optional what3words address for the horsebox / lorry entrance gate. */
  lorryWhat3Words?: string | null;
  /** Optional latitude of the horsebox / lorry entrance gate. */
  lorryLatitude?: number | null;
  /** Optional longitude of the horsebox / lorry entrance gate. */
  lorryLongitude?: number | null;
  /** Optional approach notes and low-bridge/narrow-lane warnings for horseboxes and lorries. */
  lorryDirectionsNote?: string | null;
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
  /** Optional external https:// payment link (Stripe Payment Link, SumUp, PayPal) shown alongside BACS instructions. */
  paymentLinkUrl?: string | null;
  /** When true the public signup form is hidden and the API rejects new signups. */
  signupsLocked?: boolean;
  /** Explicit capability from APIs that keep trainer messages private. Missing means unavailable. */
  staffChatEnabled?: boolean;
  /** A sample event: its payments are tests only. */
  isDemo?: boolean;
  /** The organiser's terms and conditions as plain text; empty means the sign-up form shows a placeholder. */
  termsText?: string | null;
  /** The hatband colour in each lane, index 0 being lane 1; set when the competition is created. Null when not set. */
  laneHatbands?: string[] | null;
  /** Where entry fees are paid out: the organiser's club and its masked account. Public, no personal data. */
  payoutsTo?: PayoutsTo | null;
  /** Venue capacity limit for stables across entries and shop orders. Null when unlimited. */
  maxStables?: number | null;
  /** Venue capacity limit for electric hook-ups across entries and shop orders. Null when unlimited. */
  maxHookups?: number | null;
  /** Remaining stables available at this venue when `maxStables` is set. */
  stablesRemaining?: number | null;
  /** Remaining electric hook-ups available at this venue when `maxHookups` is set. */
  hookupsRemaining?: number | null;
}

export interface CompetitionEntrySettings {
  competitionId: number;
  entriesCloseAt?: string | null;
  entriesClosed: boolean;
  maxStables?: number | null;
  maxHookups?: number | null;
  stablesBooked?: number;
  hookupsBooked?: number;
  stablesRemaining?: number | null;
  hookupsRemaining?: number | null;
}

/** The public summary of a club's payouts. `maskedAccount` is like "••••1234" and only appears once `ready`. */
export interface PayoutsTo {
  clubName: string;
  maskedAccount: string | null;
  ready: boolean;
}

/** Payout set-up status: 0 not started, 1 in progress, 2 ready. */
export type PayoutStatus = 0 | 1 | 2;
/** 0 individual or sole trader, 1 club or association, 2 registered charity, 3 company. */
export type PayoutBusinessType = 0 | 1 | 2 | 3;
/** 0 UK (GBP), 1 Ireland or the EU (EUR). */
export type PayoutRegion = 0 | 1;
/** 0 daily, 1 weekly, 2 after each event. */
export type PayoutSchedule = 0 | 1 | 2;

/** Saved bank details as the API returns them: masked only. */
export interface PayoutBank {
  accountHolder: string;
  bankName: string | null;
  sortCode: string | null;
  maskedAccount: string;
  ibanCountry: string | null;
}

/** A club's payout set-up, for its managers and admins. Includes the responsible person's date of birth. */
export interface ClubPayouts {
  clubId: number;
  clubName: string;
  status: PayoutStatus;
  businessType: PayoutBusinessType | null;
  region: PayoutRegion;
  currency: string;
  legalName: string | null;
  tradingName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  postcode: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  registrationNumber: string | null;
  vatNumber: string | null;
  personFullName: string | null;
  /** YYYY-MM-DD. */
  personDateOfBirth: string | null;
  statementDescriptor: string | null;
  schedule: PayoutSchedule;
  bank: PayoutBank | null;
  /** Field keys still missing or invalid before the account can be finished. */
  missing: string[];
  updatedAt: string | null;
}

export type ArrivalWindow = 'FridayEvening' | 'SaturdayMorning' | 'Other';
export type FeeDisposition = 'None' | 'RefundPending' | 'Refunded' | 'Retained' | 'CreditRollover';

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
  lookingForPair?: boolean;
  lookingForGuestRiders?: boolean;
  waitingForGuestSpot?: boolean;
  pairRequestFromSignupId?: number | null;
  pairRequestFromName?: string | null;
  pairRequestFromClub?: string | null;
  pairRequestToSignupId?: number | null;
  pairRequestToName?: string | null;
  pairRequestStatus?: string | null;
  declarationAccessGranted?: boolean;
  stablesCount?: number;
  hookupsCount?: number;
  stablingClubOrTeam?: string | null;
  paymentMethod?: string | null;
  isWaitlist?: boolean;
  isWithdrawn?: boolean;
  refundPending?: boolean;
  teamsCount?: number;
  drawComplete?: boolean;
  linkedTeams?: { id: number; name: string }[];
  /** Assigned barn / stable boxes, e.g. "Barn B, Boxes 14–18". */
  stableAssignment?: string | null;
  /** Assigned electric hook-up pitch, e.g. "Hook-up Post 4". */
  hookupAssignment?: string | null;
  /** Lorry or towing vehicle registration plate. */
  vehicleRegistration?: string | null;
  /** Arrival or stabling notes for the gate steward. */
  arrivalNotes?: string | null;
  /** Organiser's bank transfer / payment instructions for this competition. */
  paymentDestination?: string | null;
  /** Organiser's external https:// payment link (Stripe, SumUp, PayPal) for this competition. */
  paymentLinkUrl?: string | null;
  competitionEnd?: string | null;
  competitionLocation?: string | null;
  competitionPostcode?: string | null;
  competitionWhat3Words?: string | null;
  arrivalWindow?: ArrivalWindow | null;
  feeDisposition?: FeeDisposition;
  refundedAmountMinor?: number | null;
  dispositionNote?: string | null;
  dispositionUpdatedAt?: string | null;
  waitlistOfferedAt?: string | null;
  waitlistOfferExpiresAt?: string | null;
  /** The rider, parent and emergency contact on your own guest or individual entry (`GET /me/signups`). */
  guest?: SignupGuestDetails | null;
}

/**
 * The rider on a guest or individual entry when an adult enters for a child, plus the parent or guardian and an
 * emergency contact (`SignupGuestDetailsDto`). Personal data about a child: only the competition's staff
 * (`GET /competitions/:id/signups`) and the person who made the entry (`GET /me/signups`, the create reply) get it.
 * Never show it on a public page, share card or export.
 */
export interface SignupGuestDetails {
  riderName: string | null;
  /** A calendar date, `yyyy-MM-dd`. */
  riderDateOfBirth: string | null;
  ponyName: string | null;
  guardianName: string | null;
  /** Tidied by the server (`07700900123`, `+447700900123`). */
  guardianPhone: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
}

/**
 * The guest rider fields of `POST /competitions/:id/sections/:sectionId/signups` (`CreateSectionSignupInput`).
 * Names need their phone number and the reverse; phones must be UK or Irish; the date of birth is `yyyy-MM-dd` or
 * `dd/mm/yyyy` and in the past. Whole-team entries drop them.
 */
export interface SignupGuestDetailsInput {
  riderName?: string | null;
  riderDateOfBirth?: string | null;
  ponyName?: string | null;
  guardianName?: string | null;
  guardianPhone?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
}

export interface FormedTeamPreview {
  clubName: string;
  clubId: number;
  suffix: string;
  signupIds: number[];
  riderNames: string[];
  teamName?: string | null;
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
  lookingForPair?: boolean;
  lookingForGuestRiders?: boolean;
  waitingForGuestSpot?: boolean;
  pairRequestFromSignupId?: number | null;
  pairRequestToSignupId?: number | null;
  pairRequestStatus?: string | null;
  stablesCount?: number;
  hookupsCount?: number;
  stablingClubOrTeam?: string | null;
  paymentMethod?: string | null;
  isWaitlist?: boolean;
  isWithdrawn?: boolean;
  refundPending?: boolean;
  teamsCount?: number;
  /** Assigned barn / stable boxes, e.g. "Barn B, Boxes 14–18". */
  stableAssignment?: string | null;
  /** Assigned electric hook-up pitch, e.g. "Hook-up Post 4". */
  hookupAssignment?: string | null;
  /** Lorry or towing vehicle registration plate. */
  vehicleRegistration?: string | null;
  /** Arrival or stabling notes for the gate steward. */
  arrivalNotes?: string | null;
  lastReminderSentAt?: string | null;
  arrivalWindow?: ArrivalWindow | null;
  feeDisposition?: FeeDisposition;
  refundedAmountMinor?: number | null;
  dispositionNote?: string | null;
  dispositionUpdatedAt?: string | null;
  waitlistOfferedAt?: string | null;
  waitlistOfferExpiresAt?: string | null;
  /** Staff-only (and the entrant's own create reply): the guest rider, parent and emergency contact. */
  guest?: SignupGuestDetails | null;
}

export interface UpdateSignupStablingInput {
  stableAssignment?: string | null;
  hookupAssignment?: string | null;
  vehicleRegistration?: string | null;
  arrivalNotes?: string | null;
}

export interface StablingBooking {
  signupId: number;
  sectionId: number;
  sectionName: string;
  fullName: string;
  ponyClubOrTeam: string;
  stablesCount: number;
  hookupsCount?: number;
  status: SignupPaymentStatus;
  stableAssignment?: string | null;
  hookupAssignment?: string | null;
  vehicleRegistration?: string | null;
  arrivalNotes?: string | null;
  arrivalWindow?: ArrivalWindow | null;
}

export interface StablingSummary {
  totalStables: number;
  totalHookups?: number;
  maxStables?: number | null;
  maxHookups?: number | null;
  stablesRemaining?: number | null;
  hookupsRemaining?: number | null;
  bookings: StablingBooking[];
}

export interface SendUnpaidRemindersInput {
  signupIds: number[];
  customNote?: string | null;
}

export interface SendUnpaidRemindersResult {
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  sentAt: string;
  signups: SectionSignup[];
}

export interface UpdateSignupArrivalInput {
  arrivalWindow?: ArrivalWindow | null;
  vehicleRegistration?: string | null;
}

export interface ArrivalManifestEntry {
  signupId: number;
  competitionSectionId: number;
  sectionName: string;
  fullName: string;
  ponyClubName?: string | null;
  teamName?: string | null;
  teamsCount: number;
  stablesCount: number;
  stablingClubOrTeam?: string | null;
  arrivalWindow: ArrivalWindow;
  vehicleRegistration?: string | null;
  status: SignupPaymentStatus;
}

export interface ArrivalManifest {
  fridayEvening: ArrivalManifestEntry[];
  saturdayMorning: ArrivalManifestEntry[];
  other: ArrivalManifestEntry[];
}

export interface UpdateSignupDispositionInput {
  feeDisposition: FeeDisposition;
  refundedAmountMinor?: number | null;
  dispositionNote?: string | null;
}

export interface FeeDispositionLedgerSummary {
  totalRetainedMinor: number;
  totalRefundedMinor: number;
  refundsPendingMinor: number;
  creditsRolledOverMinor: number;
  rows: SectionSignup[];
}

export interface MarkClubPaidInput {
  ponyClubName?: string | null;
  signupIds?: number[] | null;
}

export interface MarkClubPaidResult {
  ponyClubName: string;
  clubBacsReference: string;
  markedPaidCount: number;
  totalAmountMinor: number;
  signups: SectionSignup[];
}

export interface ClubInvoiceGroup {
  clubName: string;
  clubSlug: string;
  clubBacsReference: string;
  signupsCount: number;
  teamsCount: number;
  stablesCount: number;
  totalAmountMinor: number;
  totalDueMinor: number;
  totalPaidMinor: number;
  signups: SectionSignup[];
}

/**
 * One choice a seller offers for a catalogue item, usually a size (`CatalogueItemOptionDto`). Sent as `options` on
 * catalogue items and public listings. `stockQuantity` null means no limit for that option; 0 means sold out.
 */
export interface CatalogueItemOption {
  id: number;
  label: string;
  stockQuantity: number | null;
}

/**
 * An option in `POST`/`PUT /commerce/catalogue` (`CatalogueItemOptionInput`). Send an existing option's `id` to keep it
 * (its sales and stock stay with it); leave `id` out for a new one. On `PUT`, omitting `options` leaves them alone and
 * an empty list removes them. Labels are 1 to 40 characters, unique, at most 30 options.
 */
export interface CatalogueItemOptionInput {
  id?: number | null;
  label: string;
  stockQuantity: number | null;
}

/** The option fields on an order line (`EventOrderLineDto`); both null when the item had no options. */
export interface EventOrderLineOption {
  optionId?: number | null;
  /** The option's label when the order was made ("M"), kept even if the seller renames it later. */
  optionLabel?: string | null;
}

/** A line of `POST /commerce/competitions/:id/orders` (`CreateEventOrderLineRequest`). */
export interface CreateEventOrderLine {
  listingId: number;
  quantity: number;
  detail?: string | null;
  /** Required when the item has options, refused when it has none. */
  optionId?: number | null;
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
  /** Points scored in the team's final; null when it is in no lettered final. */
  finalPoints?: number | null;
  /** Points scored before the final; null when it is in no lettered final. When the section doesn't carry points, `totalPoints` is `finalPoints` alone. */
  earlierPoints?: number | null;
  /** Manual referee tie-break order when set. */
  tieBreakOrder?: number | null;
  /** Plain-English explanation when two adjacent teams share the same total points. */
  tieBreakReason?: string | null;
  refereeCard?: 'yellow' | 'red' | null;
  flag?: string | null;
  bibDescription?: string | null;
}

/** Matches `TackCheckMode`: 0 pass or fail only, 1 a separate Tack & Turnout table, 2 bonus points in the standings. */
export type TackCheckMode = 0 | 1 | 2;

export interface TackCheckSector { id: number; name: string }
export interface TackCheckMark { sectorId: number; passed: boolean | null; points: number | null; riderPoints?: (number | null)[] | null }

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
  riders?: string[] | null;
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

export type EquineVaccineStatus = 'Certified' | 'Expired' | 'TooRecent' | 'Unchecked';

export interface PassportCheckPony {
  ponyName: string;
  riders: string[];
  checkedAt: string | null;
  checkedByName: string | null;
  passportCode?: string | null;
  ownerFullName?: string | null;
  certified?: boolean;
  status?: EquineVaccineStatus;
  lastFluVaccineDate?: string | null;
  fluValidUntil?: string | null;
  lastTetanusDate?: string | null;
  tetanusValidUntil?: string | null;
  inspectorRole?: string | null;
  officialNotes?: string | null;
}

export interface CertifiedHorseLookup {
  found: boolean;
  certified: boolean;
  status: EquineVaccineStatus;
  passportCode?: string | null;
  horseName?: string | null;
  ownerFullName?: string | null;
  lastFluVaccineDate?: string | null;
  fluValidUntil?: string | null;
  lastTetanusDate?: string | null;
  tetanusValidUntil?: string | null;
  inspectorRole?: string | null;
  inspectedByName?: string | null;
  inspectedAt?: string | null;
  officialNotes?: string | null;
}

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
  // The answers below depend on what the organiser asks for. They are personal data about a child, so only staff and the
  // submitting trainer are sent them; a public page never has any of them.
  birthYear?: number | null;
  ageGroup?: string | null;
  weightKg?: number | null;
  ponyPassportNumber?: string | null;
  ponyOwnerFullName?: string | null;
  ponyAge?: number | null;
  membershipNumber?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  medicalNotes?: string | null;
  /** The organiser's own questions, keyed by field id. */
  customValues?: Record<string, string | null> | null;
  /** Plain-English notes where an answer broke the organiser's number rules. Staff and the submitter only. */
  flags?: string[] | null;
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
  /** The team name the entrant gave when entering, so the form is clearly the one for that entry. Public, like the team's name. */
  entryTeamName?: string | null;
  /** The coach's phone number for this team. Staff and the submitter only. */
  trainerPhone?: string | null;
  /** How many riders on the form broke a rule. Staff and the submitter only; 0 for everyone else. */
  flagCount?: number;
}

/** A previously declared team that the signed-in trainer, manager or entrant can pick to auto-fill a new dec form (`GET /declaration-forms/my-saved-teams`). */
export interface SavedTeamDeclaration {
  formId?: number;
  declarationFormId?: number;
  teamId: number;
  teamName: string;
  entryTeamName?: string | null;
  clubId?: number;
  clubName: string;
  sectionId?: number;
  sectionName: string;
  ageGroup: string;
  format: SectionFormat;
  competitionId: number;
  competitionName: string;
  competitionStartDate?: string;
  competitionStart?: string;
  submittedAt: string;
  bibDescription?: string | null;
  trainerName?: string | null;
  trainerPhone?: string | null;
  form?: DeclarationForm;
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
  ponyHeightHands?: number | null;
  ponyPassportNumber?: string | null;
  ponyOwnerFullName?: string | null;
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

export type LiveStreamStatus = 0 | 1 | 2 | 3;
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
/** Who started a running stream (`GET /competitions/{id}/streams/publishers`, staff only). The name is null when the API doesn't know it. */
export interface StreamPublisher { streamId: number; startedByName: string | null }
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

/** 0 = Score only, 1 = Tripod camera only, 2 = Score + Stream controller. */
export type ScorerLinkScope = 0 | 1 | 2;
export const ScorerLinkScope = {
  Score: 0 as ScorerLinkScope,
  Camera: 1 as ScorerLinkScope,
  ScoreAndStream: 2 as ScorerLinkScope,
};

/** A scorer link as the organiser sees it (`/competitions/{id}/scorer-links`). The token is never part of it. */
export interface ScorerLink {
  id: number;
  label: string;
  arenaName: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  scope?: ScorerLinkScope;
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
  scope?: ScorerLinkScope;
}

export type StreamQualityRid = 'f' | 'h' | 'q';
export type StreamQualityPreset = 'auto' | '360p' | '480p' | '720p' | '1080p';

export interface StreamTelemetry {
  streamId: number;
  arenaName: string;
  batteryLevel?: number | null;
  batteryCharging?: boolean | null;
  zoom?: number | null;
  maxZoom?: number | null;
  fps?: number | null;
  bitrateKbps?: number | null;
  signal?: string | null;
  audioMuted?: boolean | null;
  windFilter?: boolean | null;
  qualityPreset?: StreamQualityPreset | string | null;
  captureResolution?: string | null;
  updatedAt: string;
}

export interface StreamCommand {
  streamId: number;
  arenaName: string;
  command: 'setZoom' | 'mute' | 'pause' | 'flipCamera' | 'windFilter' | 'saveReplay' | 'setQualityPreset' | 'selectAngle';
  value?: string | null;
  issuedAt: string;
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

/** Impressions and live stream on-screen time for one human-friendly sponsor placement. */
export interface SponsorPlacementStat {
  key: 'overview' | 'standings' | 'timetable' | 'liveStreamOverlay' | 'sponsorPage' | string;
  label: 'Overview' | 'Standings' | 'Timetable' | 'Live Stream Overlay' | 'Sponsor Page' | string;
  views: number;
  seconds: number;
  formattedOnScreenTime: string;
}

/** Proof-of-value impact summary for one sponsor across all placements. */
export interface SponsorValueReportItem {
  sponsorId: number;
  sponsorName: string;
  linkUrl: string | null;
  logoUrl: string | null;
  tier: SponsorTier;
  tierLabel: string;
  showOn: number;
  placementLabels: string[];
  isEnabled: boolean;
  totalViews: number;
  totalSeconds: number;
  formattedOnScreenTime: string;
  placements: SponsorPlacementStat[];
}

/** Competition-wide sponsor proof-of-value report (`GET /competitions/:id/sponsor-stats`). */
export interface SponsorValueReport {
  competitionId: number;
  totalViews: number;
  totalSeconds: number;
  formattedTotalOnScreenTime: string;
  sponsors: SponsorValueReportItem[];
}

/** Status of the 30-minute undo snapshot for the last section draw, heat deletion, or heat regeneration (`GET /competitions/:id/draw-undo`). */
export interface DrawUndoStatus {
  available: boolean;
  undoId: number | null;
  kind: string | null;
  label: string | null;
  sectionId: number | null;
  sessionId: number | null;
  createdAt: string | null;
  expiresAt: string | null;
  affectedHeats: number;
  affectedSessions: number;
}

/** Result of restoring the latest draw or heat snapshot (`POST /competitions/:id/draw-undo`). */
export interface DrawUndoResult {
  restored: boolean;
  label: string;
  restoredSessions: number;
  restoredHeats: number;
  undoStatus: DrawUndoStatus;
}

/** Role assigned to a rider for a single race in the 5-rider Race Line-Up & Sit-Out Planner. */
export type RiderRaceRole = '1' | '2' | '3' | '4' | 'sit-out';

/** Shared race line-up and sit-out assignments for a team (`GET/PUT /competitions/:id/teams/:teamId/race-lineup`). */
export interface TeamRaceLineupPlan {
  competitionId: number;
  teamId: number;
  /** Keyed by race key (e.g. `String(race.id)` or `${heat.id}:${race.orderIndex}`), inner map keyed by rider key (`String(rider.id)` or rider name). */
  assignments: Record<string, Record<string, RiderRaceRole | string>>;
  updatedAt?: string | null;
}

/** Summary of a printable race session for the single-session noticeboard filter. */
export interface PrintableSessionSummary {
  sessionId: number;
  sessionName: string;
  sectionName: string;
  orderIndex: number;
  totalHeats: number;
  completedHeats: number;
  isCompleted: boolean;
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
  bFinals?: number;
  cFinals?: number;
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
  averagePoints?: number | null;
  averagePlace?: number | null;
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

export interface StatsClub {
  clubName: string;
  entries: number;
  competitions: number;
  firstDate?: string | null;
  lastDate?: string | null;
}

export interface StatsSeasonStanding {
  seasonId: string;
  teamProfileId: string;
  teamName: string;
  seasonName: string;
  year: number;
  rank?: number | null;
  points: number;
  eventsEntered: number;
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
  clubs?: StatsClub[] | null;
  seasons?: StatsSeasonStanding[] | null;
}

// ---- Volunteer shifts and claims (#16) ----

export interface VolunteerClaim {
  id: number;
  shiftId: number;
  userId: string;
  volunteerName: string;
  clubName?: string | null;
  /** Visible to competition staff only; null for public and ordinary signed-in viewers. */
  contactPhone?: string | null;
  claimedAt: string;
  isMine?: boolean;
}

export type StewardDutyCategory = 'General' | 'ArenaCrew' | 'LineSteward' | 'ChangeoverSteward' | string;
export type StewardAttendanceStatus = 'Assigned' | 'Here' | 'Missing' | string;

export interface VolunteerShift {
  id: number;
  competitionId: number;
  sessionId?: number | null;
  sessionName?: string | null;
  arenaName?: string | null;
  role: string;
  startTimeLabel?: string | null;
  notes?: string | null;
  requiredCount: number;
  claimedCount: number;
  remainingCount: number;
  isFilled: boolean;
  claims: VolunteerClaim[];
  dutyCategory?: StewardDutyCategory;
  assignedTeamId?: number | null;
  assignedTeamName?: string | null;
  assignedClubName?: string | null;
  laneNumber?: number | null;
  attendanceStatus?: StewardAttendanceStatus;
  checkedInAt?: string | null;
  checkedInByName?: string | null;
  checkedInByStaffOverride?: boolean;
  canViewerCheckIn?: boolean;
}

export interface CreateVolunteerShiftInput {
  role: string;
  sessionId?: number | null;
  arenaName?: string | null;
  startTimeLabel?: string | null;
  notes?: string | null;
  requiredCount?: number;
  dutyCategory?: StewardDutyCategory | null;
  assignedTeamId?: number | null;
  assignedClubName?: string | null;
  laneNumber?: number | null;
}

export interface ClaimVolunteerShiftInput {
  volunteerName?: string | null;
  clubName?: string | null;
  contactPhone?: string | null;
}

export interface SessionDutyRoleAssignmentInput {
  role: string;
  dutyCategory?: StewardDutyCategory;
  assignedTeamId?: number | null;
  assignedClubName?: string | null;
  laneNumber?: number | null;
  requiredCount?: number;
  startTimeLabel?: string | null;
  notes?: string | null;
}

export interface AssignSessionDutiesInput {
  duties?: SessionDutyRoleAssignmentInput[] | null;
  autoAssignNonRidingTeams?: boolean;
  includeChangeoverLineStewards?: boolean;
  replaceExistingSessionDuties?: boolean;
}

export interface CallMissingStewardResult {
  shift: VolunteerShift;
  announcement: ChatMessage;
}

// ---- Arena Crew & Line Steward Phone Prop Sheet (#4) ----

export interface ArenaCrewZoneProps {
  zoneKey: 'start' | 'centre' | 'top' | string;
  zoneLabel: string;
  items: string[];
  summaryText: string;
}

export interface ArenaCrewRaceCard {
  raceId?: number | null;
  raceName: string;
  orderIndex: number;
  bendingPolesPerLane: number;
  summary?: string | null;
  zones: ArenaCrewZoneProps[];
}

export interface ArenaCrewTransitionDiff {
  bringIn: string[];
  clearOut: string[];
  keepInRing: string[];
  summaryText: string;
}

export interface ArenaCrewPropSheet {
  competitionId: number;
  sessionId?: number | null;
  sessionName?: string | null;
  arenaName?: string | null;
  heatId?: number | null;
  heatLabel?: string | null;
  lanesPerHeat: number;
  currentRace?: ArenaCrewRaceCard | null;
  nextRace?: ArenaCrewRaceCard | null;
  transition?: ArenaCrewTransitionDiff | null;
  allHeatRaces: ArenaCrewRaceCard[];
}

// ---- Live Commentator Briefing Engine (#11) ----

export interface CommentatorLaneSquad {
  laneIndex: number;
  teamId: number;
  teamName: string;
  clubName: string;
  bibColour?: string | null;
  bibDescription?: string | null;
  flag?: string | null;
  currentRank?: number | null;
  totalPoints: number;
  ridersAndPonies: string[];
  stakesHeadline?: string | null;
  gameSpecialistNote?: string | null;
}

export interface CommentatorBriefing {
  competitionId: number;
  sessionId: number;
  sessionName: string;
  heatId: number;
  heatLabel: string;
  currentRaceId?: number | null;
  currentRaceName?: string | null;
  talkingPoints: string[];
  biggestMoverHeadline?: string | null;
  lanes: CommentatorLaneSquad[];
}

// ---- Emergency contact quick search (#151, staff only) ----

export interface EmergencyContactEntry {
  riderEntryId: number;
  riderName: string;
  ponyName?: string | null;
  teamId: number;
  teamName: string;
  sectionId: number;
  sectionName: string;
  clubName: string;
  bibColour?: string | null;
  bibDescription?: string | null;
  isReserve: boolean;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  medicalNotes?: string | null;
  trainerName?: string | null;
  trainerPhone?: string | null;
}

export interface EventArchiveDto {
  competitionId: number;
  competitionName: string;
  fileName: string;
  generatedAt: string;
  files: Record<string, string>;
}

export interface PublicResultsSummaryDto {
  competitionId: number;
  competitionName: string;
  isProvisional: boolean;
  generatedAt?: string;
  summaryText: string;
}
