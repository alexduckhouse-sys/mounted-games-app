import {
  defaultArena, lanesOfArena, MAX_ARENAS, sectionLocked, type ArenaDraft, type CreatorDraft, type SectionDraft,
} from './creatorDraft';

/**
 * Changing the arenas: how the age groups follow. An arena that is renamed takes its age groups with it; one that is
 * removed hands them to the first arena; an arena whose lanes change gives its age groups heats of that size. Age groups
 * that have heats or scores keep the size they have.
 */
export function changeArenas(draft: CreatorDraft, next: ArenaDraft[]): Pick<CreatorDraft, 'arenas' | 'sections'> {
  const before = draft.arenas;
  const sections = draft.sections.map((s): SectionDraft => {
    const at = before.findIndex((a) => a.name === s.arena);
    const index = at >= 0 && at < next.length ? at : 0;
    const arena = next[index];
    if (!arena) return s;
    const lanesBefore = at >= 0 ? lanesOfArena(before[at]) : null;
    const lanes = lanesOfArena(arena);
    const moved = at < 0 || at >= next.length;
    const heat = sectionLocked(s) ? s.maxTeamsPerHeat : moved ? String(Math.min(lanes, parseInt(s.maxTeamsPerHeat, 10) || lanes)) : lanesBefore !== lanes ? String(lanes) : s.maxTeamsPerHeat;
    return { ...s, arena: arena.name, maxTeamsPerHeat: heat };
  });
  return { arenas: next, sections };
}

/** The arena count: grows with new arenas, shrinks from the end. */
export function resizeArenas(draft: CreatorDraft, count: number): Pick<CreatorDraft, 'arenas' | 'sections'> {
  const wanted = Math.max(1, Math.min(MAX_ARENAS, Math.round(count) || 1));
  const next = draft.arenas.slice(0, wanted);
  while (next.length < wanted) {
    let candidate = defaultArena(next.length);
    for (let n = next.length; next.some((a) => a.name === candidate.name); n++) candidate = defaultArena(n + 1);
    next.push(candidate);
  }
  return changeArenas(draft, next);
}

/** Puts an age group in an arena, with heats no bigger than the arena's lanes. */
export function setSectionArena(draft: CreatorDraft, sectionIndex: number, name: string): SectionDraft[] {
  const arena = draft.arenas.find((a) => a.name === name);
  if (!arena) return draft.sections;
  const lanes = lanesOfArena(arena);
  return draft.sections.map((s, i) => (i !== sectionIndex ? s : {
    ...s, arena: arena.name,
    maxTeamsPerHeat: sectionLocked(s) ? s.maxTeamsPerHeat : String(Math.min(lanes, parseInt(s.maxTeamsPerHeat, 10) || lanes)),
  }));
}
