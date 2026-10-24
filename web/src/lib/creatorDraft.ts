import { sectionDisplayName } from './section';

/** The competition creator's draft: what the person has typed, step by step, before anything is saved. */

export type Format = 1 | 2 | 3;
export const FORMAT_LABEL: Record<Format, string> = { 1: 'Pairs', 2: 'Teams', 3: 'Individual' };
export const AGE_GROUP_PRESETS = ['Under 10', 'Under 12', 'Under 14', 'Under 15', 'Under 17', 'Open', 'Juniors', 'Seniors', 'Novices'];

export const MAIN_ARENA = 'Main arena';
/** Minutes a whole heat takes in the arena, including every race in its list. */
export const DEFAULT_MINUTES = 10;
export const lanesFor = (format: number) => (format === 1 ? 4 : 6);
export const MAX_SESSIONS = 6;

export const STEP_IDS = ['about', 'when', 'sections', 'structure', 'races', 'dec', 'payment', 'review'] as const;
export type StepId = typeof STEP_IDS[number];
export const STEP_LABEL: Record<StepId, string> = {
  about: 'About', when: 'When & where', sections: 'Sections', structure: 'Structure & timing', races: 'Races', dec: 'Dec form', payment: 'Payment & notes', review: 'Review',
};

export interface SessionDraft {
  /** The saved session this is, when editing. */
  existingId?: number;
  /** Its name as saved. New sessions are named when they are created. */
  name?: string;
  /** The races chosen for each heat; null means "decide later". */
  races: string[] | null;
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

export interface CreatorDraft {
  step: number;
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
  what3Words: string;
  appleMapsUrl: string;
  lat: string;
  lon: string;
  description: string;
  paymentDestination: string;
  termsText: string;
  sections: SectionDraft[];
  breaks: BreakDraft[];
  /** Hatband colour per lane, index 0 being lane 1. Lanes the person hasn't set take the default order. */
  laneHatbands: string[];
}

export const HATBAND_COLOURS = ['Red', 'White', 'Blue', 'Yellow', 'Green', 'Black', 'Orange', 'Pink'];
export const MAX_LANES = 20;

/** How many lanes the competition needs: the largest heat across the age groups. */
export function laneCount(sections: readonly SectionDraft[]): number {
  return Math.max(1, Math.min(MAX_LANES, Math.max(0, ...sections.map((s) => wholeNumber(s.maxTeamsPerHeat) ?? lanesFor(s.format)))));
}

/** The hatband for each lane: what was chosen, else the next colour in the default order. */
export function hatbandsFor(draft: Pick<CreatorDraft, 'sections' | 'laneHatbands'>): string[] {
  return Array.from({ length: laneCount(draft.sections) }, (_, i) => draft.laneHatbands[i]?.trim() || HATBAND_COLOURS[i % HATBAND_COLOURS.length]);
}

export function defaultSection(format: Format = 2): SectionDraft {
  return {
    format, ageGroup: 'Seniors', priceGbp: '', maxParticipants: '', usesRaceFinals: false, finalistCount: '', runoffRaceName: '',
    minutesPerRace: String(DEFAULT_MINUTES), maxTeamsPerHeat: String(lanesFor(format)), arena: MAIN_ARENA, sessions: [{ races: null }],
    finalRaces: null,
  };
}

export function defaultDraft(today: Date = new Date()): CreatorDraft {
  return {
    step: 0, name: '', icon: 'flag', organiserName: '',
    startDate: today.toISOString().slice(0, 10), startTime: '09:00', endDate: '', endTime: '17:00',
    location: '', postcode: '', what3Words: '', appleMapsUrl: '', lat: '', lon: '', description: '', paymentDestination: '', termsText: '',
    sections: [defaultSection()], breaks: [], laneHatbands: [],
  };
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
  while (sessions.length < wanted) sessions.push({ races: null });
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
  if (step === 'about') {
    if (!draft.name.trim()) found.name = 'Enter a name.';
  } else if (step === 'when') {
    if (!draft.startDate) found.startDate = 'Choose a start date.';
    if (!draft.startTime) found.startTime = 'Choose a start time.';
    if (draft.endDate && draft.startDate && draft.endDate < draft.startDate) found.endDate = 'The end can’t be before the start.';
  } else if (step === 'sections') {
    const seen = new Set<string>();
    draft.sections.forEach((s, i) => {
      const age = s.ageGroup.trim();
      if (!age) { found[`section.${i}.ageGroup`] = 'Enter an age group.'; return; }
      const key = `${s.format}|${age.toLowerCase()}`;
      if (seen.has(key)) found[`section.${i}.ageGroup`] = 'You already have this age group in this format.';
      seen.add(key);
      if (s.priceGbp.trim() && !(Number.isFinite(parseFloat(s.priceGbp)) && parseFloat(s.priceGbp) >= 0)) found[`section.${i}.price`] = 'Enter a price, or leave it empty for free.';
      if (s.maxParticipants.trim() && !(wholeNumber(s.maxParticipants) !== null)) found[`section.${i}.max`] = 'Enter a whole number, or leave it empty for no limit.';
    });
  } else if (step === 'structure') {
    draft.sections.forEach((s, i) => {
      const minutes = wholeNumber(s.minutesPerRace);
      if (minutes === null || minutes < 1 || minutes > 180) found[`section.${i}.minutes`] = 'Minutes per heat must be from 1 to 180.';
      const heat = wholeNumber(s.maxTeamsPerHeat);
      if (heat === null || heat < 1 || heat > 20) found[`section.${i}.heat`] = 'Teams per heat must be from 1 to 20.';
      if (s.finalistCount.trim() && parseFinalistCount(s.finalistCount) === null) found[`section.${i}.finalists`] = 'Teams in the final must be from 1 to 50.';
      if (!s.arena.trim()) found[`section.${i}.arena`] = 'Give the arena a name.';
    });
  } else if (step === 'review') {
    draft.breaks.forEach((b, i) => {
      const minutes = wholeNumber(b.minutes);
      if (!b.name.trim()) found[`break.${i}.name`] = 'Name this break.';
      if (minutes === null || minutes < 1 || minutes > 1440) found[`break.${i}.minutes`] = 'Enter how many minutes it lasts.';
      if (!b.date || !b.time) found[`break.${i}.time`] = 'Choose when it starts.';
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
    ...(typeof r.finalSessionId === 'number' ? { finalSessionId: r.finalSessionId } : {}),
    ...(r.finalHasHeats ? { finalHasHeats: true } : {}),
    ...(r.finalScored ? { finalScored: true } : {}),
    ...(r.hasEntries ? { hasEntries: true } : {}),
  };
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
  return {
    step,
    ...(typeof r.savedAt === 'string' ? { savedAt: r.savedAt } : {}),
    name: r.name,
    icon: text(r.icon, base.icon),
    organiserName: text(r.organiserName),
    startDate: text(r.startDate, base.startDate), startTime: text(r.startTime, base.startTime),
    endDate: text(r.endDate), endTime: text(r.endTime, base.endTime),
    location: text(r.location), postcode: text(r.postcode), what3Words: text(r.what3Words),
    appleMapsUrl: text(r.appleMapsUrl), lat: text(r.lat), lon: text(r.lon),
    description: text(r.description), paymentDestination: text(r.paymentDestination), termsText: text(r.termsText),
    sections,
    breaks: Array.isArray(r.breaks) ? r.breaks.map(readBreak) : [],
    laneHatbands: Array.isArray(r.laneHatbands) ? r.laneHatbands.filter((x): x is string => typeof x === 'string') : [],
  };
}
