import { api } from '../api';
import type { CompetitionSection, RaceTemplate, SectionFormat, Session } from '../types';

let templatesPromise: Promise<RaceTemplate[]> | null = null;

/** The race templates are the same for everyone, so load them once and share them between callers. A failure isn't kept. */
export function loadRaceTemplates(): Promise<RaceTemplate[]> {
  templatesPromise ??= api.get<RaceTemplate[]>('/race-templates').then((r) => r.data).catch((error) => {
    templatesPromise = null;
    throw error;
  });
  return templatesPromise;
}

/** Forgets the shared race templates (tests, or after the rules are edited). */
export function resetRaceTemplates() { templatesPromise = null; }

export const raceNameKey = (name: string) => name.toLowerCase().trim();

/** Pairs and Individual versions are picked by the section, so race lists offer only the race itself. */
export const isFormatVariant = (template: Pick<RaceTemplate, 'format'>) => template.format === 1 || template.format === 3;

/** The race names to offer in a race list: every race except the Pairs and Individual versions. */
export const raceListNames = (list: readonly RaceTemplate[]) => list.filter((t) => !isFormatVariant(t)).map((t) => t.name);

/**
 * The template a section of this format reads for a timetable race name: its Pairs or Individual version when the
 * library has one (for the race, or the race a sponsored name stands for), otherwise the race itself.
 * Mirrors `RaceVariants.Resolve` on the API.
 */
export function findRaceTemplate<T extends RaceTemplate>(list: readonly T[], name: string, format?: SectionFormat | null): T | null {
  const key = raceNameKey(name);
  const own = list.find((t) => raceNameKey(t.name) === key) ?? null;
  if (format !== 1 && format !== 3) return own;
  if (own?.format === format) return own;
  const bases = new Set([key]);
  if (own?.baseName && own.format == null) bases.add(raceNameKey(own.baseName));
  return list.find((t) => t.format === format && !!t.baseName && bases.has(raceNameKey(t.baseName))) ?? own;
}

/** The format of the section a session belongs to, if it has one. */
export function sessionFormat(competition: { sections?: readonly Pick<CompetitionSection, 'id' | 'format'>[] | null } | null | undefined, session: Pick<Session, 'competitionSectionId'> | null | undefined): SectionFormat | null {
  if (session?.competitionSectionId == null) return null;
  return competition?.sections?.find((s) => s.id === session.competitionSectionId)?.format ?? null;
}
