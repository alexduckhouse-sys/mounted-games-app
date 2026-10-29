import { isRealisticEmail } from './emailCheck';
import { tr } from '../i18n/translate.ts';
import { sectionDisplayName } from './section';

/** The competition creator's draft: what the person has typed, step by step, before anything is saved. */

export type Format = 1 | 2 | 3;
export const FORMAT_LABEL: Record<Format, string> = { 1: 'Pairs', 2: 'Teams', 3: 'Individual' };
export const AGE_GROUP_PRESETS = ['Under 8', 'Under 10', 'Under 12', 'Under 14', 'Under 15', 'Under 17', 'Under 21', 'Open', 'Juniors', 'Seniors', 'Novices', 'Veterans'];

export const MAIN_ARENA = 'Main arena';
/** Minutes a whole heat takes in the arena, including every race in its list. */
export const DEFAULT_MINUTES = 10;
export const lanesFor = (format: number) => (format === 1 ? 4 : 6);
export const MAX_SESSIONS = 6;

export const STEP_IDS = ['start', 'about', 'when', 'arenas', 'sections', 'structure', 'races', 'dec', 'payment', 'review'] as const;
export type StepId = typeof STEP_IDS[number];
export const STEP_LABEL: Record<StepId, string> = {
  start: 'Start', about: 'About', when: 'When and where', arenas: 'Arenas', sections: 'Sections', structure: 'Structure and timing', races: 'Races',
  dec: 'Dec form', payment: 'Payment and rules', review: 'Review',
};
/** How many arenas a competition can have, and how many lanes one arena can have. */
export const MAX_ARENAS = 4;
export const MIN_ARENA_LANES = 2;
export const MAX_ARENA_LANES = 12;
/** An age group's finals: one for each heat's worth of entries, at most this many (A, B and C). */
export const MAX_FINALS = 3;
export const FINAL_LETTERS = ['A', 'B', 'C'] as const;

export interface SessionDraft {
  /** The saved session this is, when editing. */
  existingId?: number;
  /** Its name as saved. New sessions are named when they are created. */
  name?: string;
  /** The races chosen for each heat; null means "decide later". */
  races: string[] | null;
  /** Session 2 onwards: the races follow Session 1's, so changing that list changes this one too. */
  sameAsFirst?: boolean;
  /** Heats have been made for it: its structure now comes from them. */
  hasHeats?: boolean;
  /** It has started or been scored. */
  scored?: boolean;
}

export interface SectionDraft {
  existingId?: number;
  format: Format;
  ageGroup: string;
  /** Pounds, as typed. */
  priceGbp: string;
  /** Cap on entries as typed; empty means no cap. */
  maxParticipants: string;
  usesRaceFinals: boolean;
  finalistCount: string;
  runoffRaceName: string;
  minutesPerRace: string;
  maxTeamsPerHeat: string;
  arena: string;
  sessions: SessionDraft[];
  /** The races chosen for the section's final; null means "decide later". */
  finalRaces?: string[] | null;
  /** Standard format only: the section ends with a final. Missing means yes. */
  hasFinal?: boolean;
  /** Standard format only: a finalist's earlier points add to its final score. Missing means off. */
  carryPointsIntoFinal?: boolean;
  /** Standard format only: final race points count double. Missing means off. */
  doublePointsInFinal?: boolean;
  /** How teams level on points are split: the API's `TieBreakRule` (0 countback, 1 last race, 2 run-off, 3 decided on the day). Missing leaves it as saved. */
  tieBreak?: number;
  /** How teams change lane after each race: the API's `LaneRotationMode` (0 move up, 1 stay, 2 move down). Missing leaves it as saved. */
  laneRotation?: number;
  /**
   * Races for the B and C finals, when the age group has more than one final. Saved on the finals session as
   * `plannedFinalRaces` ({ B: [...], C: [...] }); the A final's list is `finalRaces`.
   */
  finalRacesB?: string[] | null;
  finalRacesC?: string[] | null;
  /** The saved finals session id, when editing a competition that already has one. */
  finalSessionId?: number;
  /** Heats have been made for the finals session. */
  finalHasHeats?: boolean;
  /** The finals session has started or been scored. */
  finalScored?: boolean;
  /** Entries or teams exist: format and age group are fixed and the section can't be removed. */
  hasEntries?: boolean;
}

export interface BreakDraft {
  existingId?: number;
  /** 1 break, 2 briefing. */
  kind: 1 | 2;
  name: string;
  /** yyyy-mm-dd */
  date: string;
  /** hh:mm */
  time: string;
  minutes: string;
  /** Empty means everyone stops. */
  arena: string;
}

/** An arena: its name and how many lanes it has. Each age group runs in one of these. */
export interface ArenaDraft {
  name: string;
  /** As typed or stepped: 2 to 12. */
  lanes: string;
}

export interface CreatorDraft {
  step: number;
  /** How this draft began: from scratch, or copied from `copiedFrom`. */
  startFrom?: 'scratch' | 'copy';
  copiedFrom?: string;
  savedAt?: string;
  name: string;
  icon: string;
  organiserName: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  location: string;
  postcode: string;
  /** The governing body's number for the event. */
  competitionNumber: string;
  /** Where entrants write to the organiser. */
  contactEmail: string;
  what3Words: string;
  appleMapsUrl: string;
  lat: string;
  lon: string;
  description: string;
  paymentDestination: string;
  termsText: string;
  sections: SectionDraft[];
  /** Arenas the age groups can run in. Edited on the Arenas step; each age group names one in `arena`. */
  arenas: ArenaDraft[];
  breaks: BreakDraft[];
  /** Hatband colour per lane, index 0 being lane 1. Lanes the person hasn't set take the default order. */
  laneHatbands: string[];
  /** Whether yellow & red disciplinary cards are enabled for this competition. */
  cardsEnabled?: boolean;
  /** No hatbands at all, rather than the usual colours. */
  noHatbands?: boolean;
  /** Stewards tick off each pony's passport and vaccinations on arrival. Switched on after a new competition is created. */
  passportCheck?: boolean;
  /** True when the arena is indoors (suppresses outdoor weather warnings). */
  isIndoor?: boolean;
}

export const HATBAND_COLOURS = ['Red', 'White', 'Blue', 'Yellow', 'Green', 'Black', 'Orange', 'Pink'];
export const MAX_LANES = 20;

/** How many lanes the competition needs: the largest heat across the age groups. */
export function laneCount(sections: readonly SectionDraft[]): number {
  return Math.max(1, Math.min(MAX_LANES, Math.max(0, ...sections.map((s) => wholeNumber(s.maxTeamsPerHeat) ?? lanesFor(s.format)))));
}

/**
 * The hatbands, in lane order: the list the person made (a blank one takes the usual colour for its lane), else none when
 * they removed them all, else the usual colours for as many lanes as the biggest heat has.
 */
export function hatbandsFor(draft: Pick<CreatorDraft, 'sections' | 'laneHatbands'> & { noHatbands?: boolean }): string[] {
  if (draft.noHatbands) return [];
  if (draft.laneHatbands.length > 0) return draft.laneHatbands.slice(0, MAX_LANES).map((h, i) => h.trim() || HATBAND_COLOURS[i % HATBAND_COLOURS.length]);
  return Array.from({ length: laneCount(draft.sections) }, (_, i) => HATBAND_COLOURS[i % HATBAND_COLOURS.length]);
}

export function defaultSection(format: Format = 2): SectionDraft {
  return {
    format, ageGroup: 'Seniors', priceGbp: '', maxParticipants: '', usesRaceFinals: false, finalistCount: '', runoffRaceName: '',
    minutesPerRace: String(DEFAULT_MINUTES), maxTeamsPerHeat: String(lanesFor(format)), arena: MAIN_ARENA, sessions: [{ races: null }],
    finalRaces: null, hasFinal: true, carryPointsIntoFinal: true, doublePointsInFinal: false,
  };
}

/** Whether a section has a final of its own: standard format only, and not removed. Heat, heat, final never does. */
export const sectionHasFinal = (s: Pick<SectionDraft, 'usesRaceFinals' | 'hasFinal'>) => !s.usesRaceFinals && s.hasFinal !== false;

export function defaultDraft(today: Date = new Date()): CreatorDraft {
  return {
    step: 0, name: '', icon: 'flag', organiserName: '',
    startDate: today.toISOString().slice(0, 10), startTime: '09:00', endDate: '', endTime: '17:00',
    location: '', postcode: '', competitionNumber: '', contactEmail: '', what3Words: '', appleMapsUrl: '', lat: '', lon: '', description: '', paymentDestination: '', termsText: '',
    isIndoor: false,
    sections: [defaultSection()], arenas: [defaultArena()], breaks: [], laneHatbands: [],
  };
}

export const defaultArena = (index = 0): ArenaDraft => ({ name: index === 0 ? MAIN_ARENA : `Arena ${index + 1}`, lanes: '6' });

/** Arena names that the sections use but the arena list lacks, so a loaded competition shows what it really has. */
export function arenasFromSections(sections: readonly SectionDraft[]): ArenaDraft[] {
  const found: ArenaDraft[] = [];
  for (const s of sections) {
    const name = s.arena.trim() || MAIN_ARENA;
    const lanes = String(Math.min(MAX_ARENA_LANES, Math.max(MIN_ARENA_LANES, heatSizeOf(s))));
    const seen = found.find((a) => a.name === name);
    if (!seen) found.push({ name, lanes });
    else if (parseInt(lanes, 10) > parseInt(seen.lanes, 10)) seen.lanes = lanes;
  }
  return found.length > 0 ? found : [defaultArena()];
}

/** The arena an age group runs in. Falls back to the first arena when its own name isn't in the list. */
export const arenaOf = (draft: Pick<CreatorDraft, 'arenas'>, section: Pick<SectionDraft, 'arena'>): ArenaDraft =>
  draft.arenas.find((a) => a.name === section.arena) ?? draft.arenas[0] ?? defaultArena();

/** Lanes in an arena, as a number. */
export const lanesOfArena = (a: ArenaDraft): number => Math.min(MAX_ARENA_LANES, Math.max(MIN_ARENA_LANES, parseInt(a.lanes, 10) || 6));

/** How many finals an age group has: one for each heat's worth of entries, from 1 to 3. Zero when it has no final. */
export function finalCountOf(s: SectionDraft, lanes: number = heatSizeOf(s)): number {
  if (!sectionHasFinal(s)) return 0;
  const entries = parseMaxParticipants(s.maxParticipants);
  return Math.min(MAX_FINALS, Math.max(1, entries ? Math.ceil(entries / Math.max(1, lanes)) : 1));
}

export const sectionName = (s: Pick<SectionDraft, 'format' | 'ageGroup'>) => sectionDisplayName(s.format, s.ageGroup);
export const finalSessionName = (s: Pick<SectionDraft, 'format' | 'ageGroup'>) => `Finals · ${sectionName(s)}`;

/** A new session's name: the age group's name, with "· Session 2" and so on when there is more than one. */
export function newSessionName(section: SectionDraft, index: number): string {
  return section.sessions.length <= 1 ? sectionName(section) : `${sectionName(section)} · Session ${index + 1}`;
}

/** A session with heats made or scores can't change shape. */
export const isLocked = (s: SessionDraft) => !!(s.hasHeats || s.scored);
export const sectionLocked = (s: SectionDraft) => s.sessions.some(isLocked);

/** Grows or shrinks a section's sessions to `count`, never dropping one that has heats or scores. */
export function resizeSessions(section: SectionDraft, count: number): SectionDraft {
  const wanted = Math.max(1, Math.min(MAX_SESSIONS, Math.round(count) || 1));
  const sessions = [...section.sessions];
  while (sessions.length < wanted) sessions.push({ races: sessions[0]?.races ?? null, sameAsFirst: true });
  while (sessions.length > wanted && !isLocked(sessions[sessions.length - 1])) sessions.pop();
  return { ...section, sessions };
}

/** Heat, heat, final runs as one session. */
export function setRaceFinals(section: SectionDraft, on: boolean): SectionDraft {
  const next = { ...section, usesRaceFinals: on };
  return on ? resizeSessions(next, 1) : next;
}

/** Changing the format re-bases the heat size and finalist count when they are still the default for the old format. */
export function setFormat(section: SectionDraft, format: Format): SectionDraft {
  const oldDefault = String(lanesFor(section.format));
  const nextDefault = String(lanesFor(format));
  const heat = section.maxTeamsPerHeat === oldDefault ? nextDefault : section.maxTeamsPerHeat;
  const finalists = section.finalistCount === oldDefault ? nextDefault : section.finalistCount;
  return { ...section, format, maxTeamsPerHeat: heat, finalistCount: finalists };
}

// ---- Reading what was typed ----

/** "12.50" / "12" / "" gives pennies; negative or unreadable gives zero. */
export function priceGbpToMinor(input: string): number {
  if (!input.trim()) return 0;
  const n = parseFloat(input);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
}

/** Empty or zero means no cap. */
export function parseMaxParticipants(input: string): number | null {
  const n = parseInt(input, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Teams through to the final: 1 to 50, anything else is "not set". */
export function parseFinalistCount(input: string): number | null {
  const n = parseInt(input, 10);
  return Number.isFinite(n) && n >= 1 && n <= 50 ? n : null;
}

export const wholeNumber = (input: string): number | null => (/^\d+$/.test(input.trim()) ? parseInt(input, 10) : null);
export const minutesOf = (s: SectionDraft) => wholeNumber(s.minutesPerRace) ?? DEFAULT_MINUTES;
export const heatSizeOf = (s: SectionDraft) => wholeNumber(s.maxTeamsPerHeat) ?? lanesFor(s.format);
export const finalistCountOf = (s: SectionDraft) => parseFinalistCount(s.finalistCount) ?? heatSizeOf(s);

// ---- Validation, one step at a time ----

export type Problems = Record<string, string>;

export function validateStep(draft: CreatorDraft, step: StepId): Problems {
  const found: Problems = {};
  if (step === 'arenas') {
    const seen = new Set<string>();
    draft.arenas.forEach((a, i) => {
      const name = a.name.trim();
      if (!name) found[`arena.${i}.name`] = tr('admin.creator.problem.arenaName');
      else if (seen.has(name.toLowerCase())) found[`arena.${i}.name`] = tr('admin.creator.problem.arenaSame');
      seen.add(name.toLowerCase());
    });
  } else if (step === 'about') {
    if (!draft.name.trim()) found.name = tr('admin.creator.problem.name');
  } else if (step === 'when') {
    if (!draft.startDate) found.startDate = tr('admin.creator.problem.startDate');
    if (!draft.startTime) found.startTime = tr('admin.creator.problem.startTime');
    if (draft.endDate && draft.startDate && draft.endDate < draft.startDate) found.endDate = tr('admin.creator.problem.endBefore');
    if (draft.contactEmail.trim() && !isRealisticEmail(draft.contactEmail)) found.contactEmail = tr('admin.creator.problem.email');
  } else if (step === 'sections') {
    const seen = new Set<string>();
    draft.sections.forEach((s, i) => {
      const age = s.ageGroup.trim();
      if (!age) { found[`section.${i}.ageGroup`] = tr('admin.creator.problem.ageGroup'); return; }
      const key = `${s.format}|${age.toLowerCase()}`;
      if (seen.has(key)) found[`section.${i}.ageGroup`] = tr('admin.creator.problem.ageGroupTaken');
      seen.add(key);
      if (s.priceGbp.trim() && !(Number.isFinite(parseFloat(s.priceGbp)) && parseFloat(s.priceGbp) >= 0)) found[`section.${i}.price`] = tr('admin.creator.problem.price');
      if (s.maxParticipants.trim() && !(wholeNumber(s.maxParticipants) !== null)) found[`section.${i}.max`] = tr('admin.creator.problem.max');
    });
  } else if (step === 'structure') {
    draft.sections.forEach((s, i) => {
      const minutes = wholeNumber(s.minutesPerRace);
      if (minutes === null || minutes < 1 || minutes > 180) found[`section.${i}.minutes`] = tr('admin.creator.problem.minutes');
      const heat = wholeNumber(s.maxTeamsPerHeat);
      if (heat === null || heat < 1 || heat > 20) found[`section.${i}.heat`] = tr('admin.creator.problem.heat');
      if (s.finalistCount.trim() && parseFinalistCount(s.finalistCount) === null) found[`section.${i}.finalists`] = tr('admin.creator.problem.finalists');
      if (!s.arena.trim()) found[`section.${i}.arena`] = tr('admin.creator.problem.arenaName');
    });
  } else if (step === 'review') {
    draft.breaks.forEach((b, i) => {
      const minutes = wholeNumber(b.minutes);
      if (!b.name.trim()) found[`break.${i}.name`] = tr('admin.creator.problem.breakName');
      if (minutes === null || minutes < 1 || minutes > 1440) found[`break.${i}.minutes`] = tr('admin.creator.break.problemMinutes');
      if (!b.date || !b.time) found[`break.${i}.time`] = tr('admin.creator.break.problemStart');
    });
  }
  return found;
}

/** The first step with a problem, or null when the whole draft is fine. Used before creating. */
export function firstProblemStep(draft: CreatorDraft): StepId | null {
  for (const step of STEP_IDS) if (Object.keys(validateStep(draft, step)).length > 0) return step;
  return null;
}

// ---- Drafts kept in local storage ----

const text = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

function readSession(raw: unknown): SessionDraft {
  const r = (raw ?? {}) as Record<string, unknown>;
  const races = Array.isArray(r.races) && r.races.every((x) => typeof x === 'string') ? (r.races as string[]) : null;
  return {
    ...(typeof r.existingId === 'number' ? { existingId: r.existingId } : {}),
    ...(typeof r.name === 'string' ? { name: r.name } : {}),
    races: races && races.length > 0 ? races : null,
    ...(r.sameAsFirst === true ? { sameAsFirst: true } : {}),
    ...(r.hasHeats ? { hasHeats: true } : {}),
    ...(r.scored ? { scored: true } : {}),
  };
}

function readSection(raw: unknown): SectionDraft {
  const r = (raw ?? {}) as Record<string, unknown>;
  const base = defaultSection();
  const format: Format = r.format === 1 || r.format === 3 ? r.format : 2;
  // Older drafts held a list of sessions with a race text each: keep how many there were, not what they held.
  const sessions = Array.isArray(r.sessions) && r.sessions.length > 0 ? r.sessions.slice(0, MAX_SESSIONS).map(readSession) : base.sessions;
  const finalRaces = Array.isArray(r.finalRaces) && r.finalRaces.every((x) => typeof x === 'string') ? (r.finalRaces as string[]) : null;
  const newShape = typeof r.minutesPerRace === 'string';
  return {
    ...(typeof r.existingId === 'number' ? { existingId: r.existingId } : {}),
    format,
    ageGroup: text(r.ageGroup, base.ageGroup),
    priceGbp: text(r.priceGbp),
    maxParticipants: text(r.maxParticipants),
    usesRaceFinals: r.usesRaceFinals === true,
    finalistCount: text(r.finalistCount),
    runoffRaceName: text(r.runoffRaceName),
    minutesPerRace: newShape ? text(r.minutesPerRace, base.minutesPerRace) : base.minutesPerRace,
    maxTeamsPerHeat: newShape ? text(r.maxTeamsPerHeat, String(lanesFor(format))) : String(lanesFor(format)),
    arena: text(r.arena, MAIN_ARENA) || MAIN_ARENA,
    sessions,
    finalRaces: finalRaces && finalRaces.length > 0 ? finalRaces : null,
    hasFinal: r.hasFinal !== false,
    carryPointsIntoFinal: typeof r.carryPointsIntoFinal === 'boolean' ? r.carryPointsIntoFinal : base.carryPointsIntoFinal,
    doublePointsInFinal: r.doublePointsInFinal === true,
    ...(typeof r.finalSessionId === 'number' ? { finalSessionId: r.finalSessionId } : {}),
    ...(r.finalHasHeats ? { finalHasHeats: true } : {}),
    ...(r.finalScored ? { finalScored: true } : {}),
    ...(r.hasEntries ? { hasEntries: true } : {}),
    ...(typeof r.tieBreak === 'number' && r.tieBreak >= 0 && r.tieBreak <= 3 ? { tieBreak: r.tieBreak } : {}),
    ...(typeof r.laneRotation === 'number' && r.laneRotation >= 0 && r.laneRotation <= 2 ? { laneRotation: r.laneRotation } : {}),
    ...(raceList(r.finalRacesB) ? { finalRacesB: raceList(r.finalRacesB) } : {}),
    ...(raceList(r.finalRacesC) ? { finalRacesC: raceList(r.finalRacesC) } : {}),
  };
}

function raceList(raw: unknown): string[] | null {
  return Array.isArray(raw) && raw.length > 0 && raw.every((x) => typeof x === 'string') ? (raw as string[]) : null;
}

function readArena(raw: unknown, index: number): ArenaDraft {
  const r = (raw ?? {}) as Record<string, unknown>;
  const base = defaultArena(index);
  return { name: text(r.name, base.name), lanes: text(r.lanes, base.lanes) };
}

function readBreak(raw: unknown): BreakDraft {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    ...(typeof r.existingId === 'number' ? { existingId: r.existingId } : {}),
    kind: r.kind === 2 ? 2 : 1,
    name: text(r.name), date: text(r.date), time: text(r.time), minutes: text(r.minutes, '30'), arena: text(r.arena),
  };
}

/** Turns whatever was stored into a draft, or null when it isn't one. Understands the one-page editor's drafts too. */
export function readDraft(raw: unknown, today: Date = new Date()): CreatorDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string' || !Array.isArray(r.sections)) return null;
  const base = defaultDraft(today);
  const step = typeof r.step === 'number' && Number.isInteger(r.step) && r.step >= 0 && r.step < STEP_IDS.length ? r.step : 0;
  const sections = r.sections.length > 0 ? r.sections.map(readSection) : base.sections;
  const arenas = Array.isArray(r.arenas) && r.arenas.length > 0 ? r.arenas.slice(0, MAX_ARENAS).map(readArena) : arenasFromSections(sections);
  return {
    step,
    ...(r.startFrom === 'scratch' || r.startFrom === 'copy' ? { startFrom: r.startFrom } : {}),
    ...(typeof r.copiedFrom === 'string' ? { copiedFrom: r.copiedFrom } : {}),
    ...(typeof r.savedAt === 'string' ? { savedAt: r.savedAt } : {}),
    name: r.name,
    icon: text(r.icon, base.icon),
    organiserName: text(r.organiserName),
    startDate: text(r.startDate, base.startDate), startTime: text(r.startTime, base.startTime),
    endDate: text(r.endDate), endTime: text(r.endTime, base.endTime),
    location: text(r.location), postcode: text(r.postcode), competitionNumber: text(r.competitionNumber), contactEmail: text(r.contactEmail), what3Words: text(r.what3Words),
    appleMapsUrl: text(r.appleMapsUrl), lat: text(r.lat), lon: text(r.lon),
    description: text(r.description), paymentDestination: text(r.paymentDestination), termsText: text(r.termsText),
    sections,
    arenas,
    breaks: Array.isArray(r.breaks) ? r.breaks.map(readBreak) : [],
    laneHatbands: Array.isArray(r.laneHatbands) ? r.laneHatbands.filter((x): x is string => typeof x === 'string') : [],
    ...(typeof r.cardsEnabled === 'boolean' ? { cardsEnabled: r.cardsEnabled } : {}),
    ...(r.noHatbands === true ? { noHatbands: true } : {}),
    ...(r.passportCheck === true ? { passportCheck: true } : {}),
    isIndoor: r.isIndoor === true,
  };
}
