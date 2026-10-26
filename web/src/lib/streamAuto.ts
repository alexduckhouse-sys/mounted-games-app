import type { CompetitionDetail, Session } from '../types';

/** Automations for the stream. They live in the organiser's browser and run only while a stream controls page is open. */
export type AutoRuleKey = 'race' | 'toplist' | 'podium' | 'title' | 'sponsor';
export interface AutoRule { on: boolean; n: number }
export interface AutoState { on: boolean; rules: Record<AutoRuleKey, AutoRule> }

export const DEFAULT_AUTO: AutoState = {
  on: false,
  rules: { race: { on: true, n: 20 }, toplist: { on: true, n: 2 }, podium: { on: true, n: 0 }, title: { on: false, n: 0 }, sponsor: { on: false, n: 10 } },
};

export const AUTO_KEYS: AutoRuleKey[] = ['race', 'toplist', 'podium', 'title', 'sponsor'];

export const TOPLIST_SECONDS = 20;
export const PODIUM_SECONDS = 15;
export const TITLE_SECONDS = 10;

export interface AutoRuleInfo { key: AutoRuleKey; when: string; what: (rule: AutoRule) => string; choiceLabel: string; choices: { n: number; label: string }[] }

export const AUTO_RULES: AutoRuleInfo[] = [
  { key: 'race', when: 'After each race', what: (r) => `Heat table for ${r.n}s`, choiceLabel: 'Show for', choices: [{ n: 10, label: '10s' }, { n: 20, label: '20s' }, { n: 30, label: '30s' }] },
  { key: 'toplist', when: 'From Session 2', what: (r) => `Toplist after every ${r.n === 1 ? 'race' : `${r.n} races`}, for ${TOPLIST_SECONDS}s`, choiceLabel: 'How often',
    choices: [{ n: 1, label: 'Every race' }, { n: 2, label: 'Every 2' }, { n: 3, label: 'Every 3' }, { n: 4, label: 'Every 4' }] },
  { key: 'podium', when: 'After a session', what: () => `Podium for ${PODIUM_SECONDS}s`, choiceLabel: '', choices: [] },
  { key: 'title', when: 'Before each race', what: () => `Race title for ${TITLE_SECONDS}s`, choiceLabel: '', choices: [] },
  { key: 'sponsor', when: 'Between races', what: (r) => `Sponsors for ${r.n}s`, choiceLabel: 'Show for', choices: [{ n: 10, label: '10s' }, { n: 20, label: '20s' }] },
];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseAuto(raw: unknown): AutoState {
  const input = isRecord(raw) ? raw : {};
  const rules = isRecord(input.rules) ? input.rules : {};
  const parsed = {} as Record<AutoRuleKey, AutoRule>;
  for (const key of AUTO_KEYS) {
    const fallback = DEFAULT_AUTO.rules[key];
    const rule = isRecord(rules[key]) ? rules[key] : {};
    const choices = AUTO_RULES.find((info) => info.key === key)!.choices;
    const n = typeof rule.n === 'number' && (choices.length === 0 || choices.some((choice) => choice.n === rule.n)) ? rule.n : fallback.n;
    parsed[key] = { on: typeof rule.on === 'boolean' ? rule.on : fallback.on, n };
  }
  return { on: input.on === true, rules: parsed };
}

const storageKey = (competitionId: number) => `mg.streamAuto.${competitionId}`;

export function loadAuto(competitionId: number): AutoState {
  try {
    const text = localStorage.getItem(storageKey(competitionId));
    return parseAuto(text ? JSON.parse(text) : null);
  } catch {
    return parseAuto(null);
  }
}

export function saveAuto(competitionId: number, state: AutoState) {
  try { localStorage.setItem(storageKey(competitionId), JSON.stringify(state)); } catch { /* the choice still works until the page closes */ }
}

export type AutoCard = 'heat' | 'toplist' | 'podium' | 'title' | 'sponsor';
export interface AutoStep { card: AutoCard; seconds: number }

/** What to show, in order, after a race finishes. */
export function autoSteps(state: AutoState, context: { sessionNumber: number; racesInSection: number; sessionFinished: boolean }): AutoStep[] {
  const { rules } = state;
  const steps: AutoStep[] = [];
  if (rules.race.on) steps.push({ card: 'heat', seconds: rules.race.n });
  if (rules.toplist.on && context.sessionNumber >= 2 && rules.toplist.n > 0 && context.racesInSection % rules.toplist.n === 0) steps.push({ card: 'toplist', seconds: TOPLIST_SECONDS });
  if (rules.podium.on && context.sessionFinished) steps.push({ card: 'podium', seconds: PODIUM_SECONDS });
  if (rules.title.on) steps.push({ card: 'title', seconds: TITLE_SECONDS });
  if (rules.sponsor.on) steps.push({ card: 'sponsor', seconds: rules.sponsor.n });
  return steps;
}

const isRace = (session: Session) => (session.kind ?? (session.isBreak ? 1 : 0)) === 0;

/** Every finished race, with where it sits. Order follows the timetable. */
export function finishedRaces(competition: Pick<CompetitionDetail, 'sessions'>) {
  const found: { raceId: number; sessionId: number; sectionId: number | null }[] = [];
  for (const session of competition.sessions) {
    if (!isRace(session)) continue;
    for (const heat of session.heats) {
      for (const race of heat.races) if (race.isComplete) found.push({ raceId: race.id, sessionId: session.id, sectionId: session.competitionSectionId });
    }
  }
  return found;
}

/** The facts the rules need about one finished race. */
export function autoContext(competition: Pick<CompetitionDetail, 'sessions'>, raceId: number) {
  const done = finishedRaces(competition);
  const race = done.find((item) => item.raceId === raceId);
  if (!race) return null;
  const sameSection = competition.sessions.filter((s) => isRace(s) && s.competitionSectionId === race.sectionId).sort((a, b) => a.orderIndex - b.orderIndex);
  const session = sameSection.find((s) => s.id === race.sessionId)!;
  const races = session.heats.flatMap((heat) => heat.races);
  return {
    sessionNumber: sameSection.indexOf(session) + 1,
    racesInSection: done.filter((item) => item.sectionId === race.sectionId).length,
    sessionFinished: races.length > 0 && races.every((r) => r.isComplete),
  };
}

/** One line for the Auto tab: what happens next. */
export function autoStatus(state: AutoState, nextRaceName: string | null): string {
  if (!state.on) return 'Off. Nothing changes on its own.';
  if (state.rules.race.on && nextRaceName) return `Next: heat table after ${nextRaceName}`;
  return 'On';
}

/** The first race that hasn't finished, for the status line. */
export function nextRaceName(competition: Pick<CompetitionDetail, 'sessions'>): string | null {
  for (const session of [...competition.sessions].filter(isRace).sort((a, b) => a.orderIndex - b.orderIndex)) {
    for (const heat of [...session.heats].sort((a, b) => a.orderIndex - b.orderIndex)) {
      for (const race of [...heat.races].sort((a, b) => a.orderIndex - b.orderIndex)) if (!race.isComplete) return race.name;
    }
  }
  return null;
}
