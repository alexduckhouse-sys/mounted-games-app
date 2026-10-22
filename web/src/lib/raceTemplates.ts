import { api } from '../api';
import type { RaceTemplate } from '../types';

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
