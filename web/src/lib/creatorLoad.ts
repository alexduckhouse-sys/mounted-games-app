import type { CompetitionDetail, Session } from '../types';
import {
  arenasFromSections, defaultSection, DEFAULT_MINUTES, lanesFor, MAIN_ARENA, type BreakDraft, type CreatorDraft, type Format, type SectionDraft,
} from './creatorDraft';

import type { FixedItem } from './formatPlan';
import { computeTimings } from './time';

/** Opening a saved competition in the creator. */

const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

const kindOf = (s: Session) => s.kind ?? (s.isBreak ? 1 : 0);
/** Started, finished or with a race marked complete. */
export const hasScores = (s: Session) => s.status !== 0 || s.heats.some((h) => h.races.some((r) => r.isComplete));

/** The wizard's draft for a competition that already exists. Older competitions, with no creator data, open fine. */
export function draftFromCompetition(c: CompetitionDetail): CreatorDraft {
  const start = new Date(c.startDate);
  const end = c.endDate ? new Date(c.endDate) : null;
  const race = c.sessions.filter((s) => kindOf(s) === 0).sort((a, b) => a.orderIndex - b.orderIndex);
  const sections: SectionDraft[] = c.sections.map((s) => {
    const mine = race.filter((x) => x.competitionSectionId === s.id);
    const usesRaceFinals = s.usesRaceFinals ?? false;
    const finalsSession = !usesRaceFinals ? mine.find((x) => /^finals\s*·/i.test(x.name.trim())) : undefined;
    const qualifying = finalsSession ? mine.filter((x) => x.id !== finalsSession.id) : mine;
    const first = qualifying[0] ?? mine[0];
    const format: Format = s.format === 1 || s.format === 3 ? s.format : 2;
    return {
      existingId: s.id,
      format,
      ageGroup: s.ageGroup,
      priceGbp: s.priceMinor ? (s.priceMinor / 100).toFixed(2) : '',
      maxParticipants: s.maxParticipants != null ? String(s.maxParticipants) : '',
      usesRaceFinals,
      finalistCount: s.finalistCount ? String(s.finalistCount) : '',
      runoffRaceName: s.runoffRaceName ?? '',
      minutesPerRace: String(first?.minutesPerHeat ?? DEFAULT_MINUTES),
      maxTeamsPerHeat: String(first?.lanesPerHeat ?? lanesFor(format)),
      arena: first?.arenaName?.trim() || MAIN_ARENA,
      sessions: qualifying.length === 0 ? [{ races: null }] : qualifying.map((x) => ({
        existingId: x.id,
        name: x.name,
        races: x.plannedRaces && x.plannedRaces.length > 0 ? x.plannedRaces : null,
        ...(x.heats.length > 0 ? { hasHeats: true } : {}),
        ...(hasScores(x) ? { scored: true } : {}),
      })),
      hasFinal: s.hasFinal ?? true,
      carryPointsIntoFinal: s.carryPointsIntoFinal ?? false,
      doublePointsInFinal: s.doublePointsInFinal ?? false,
      ...(s.tieBreakRule != null ? { tieBreak: s.tieBreakRule } : {}),
      ...(first?.laneRotationMode != null ? { laneRotation: first.laneRotationMode } : {}),
      finalRaces: finalsSession?.plannedRaces && finalsSession.plannedRaces.length > 0 ? finalsSession.plannedRaces : null,
      ...(finalsSession?.plannedFinalRaces?.B?.length ? { finalRacesB: finalsSession.plannedFinalRaces.B } : {}),
      ...(finalsSession?.plannedFinalRaces?.C?.length ? { finalRacesC: finalsSession.plannedFinalRaces.C } : {}),
      ...(finalsSession ? {
        finalSessionId: finalsSession.id,
        ...(finalsSession.heats.length > 0 ? { finalHasHeats: true } : {}),
        ...(hasScores(finalsSession) ? { finalScored: true } : {}),
      } : {}),
      ...((s.activeSignupsCount ?? 0) > 0 || c.teams.some((t) => t.competitionSectionId === s.id) ? { hasEntries: true } : {}),
    };
  });
  const breaks: BreakDraft[] = c.sessions
    .filter((s) => kindOf(s) === 1 || kindOf(s) === 2)
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((s) => {
      const when = s.scheduledStart ? new Date(s.scheduledStart) : start;
      return {
        existingId: s.id, kind: kindOf(s) === 2 ? 2 : 1, name: s.name, date: localDate(when), time: s.scheduledStart ? localTime(when) : '09:00',
        minutes: String(s.durationMinutes ?? 30), arena: s.arenaName?.trim() ?? '',
      };
    });
  const finished = sections.length > 0 ? sections : [defaultSection()];
  return {
    step: 0,
    name: c.name, icon: c.icon ?? 'flag', organiserName: c.organiserName ?? '',
    startDate: localDate(start), startTime: localTime(start),
    endDate: end ? localDate(end) : '', endTime: end ? localTime(end) : '17:00',
    location: c.location ?? '', postcode: c.postcode ?? '', competitionNumber: c.competitionNumber ?? '', contactEmail: c.contactEmail ?? '', what3Words: c.what3Words ?? '', appleMapsUrl: c.appleMapsUrl ?? '',
    lat: c.latitude != null ? String(c.latitude) : '', lon: c.longitude != null ? String(c.longitude) : '',
    description: c.description ?? '', paymentDestination: c.paymentDestination ?? '', termsText: c.termsText ?? '',
    sections: finished,
    arenas: arenasFromSections(finished),
    breaks,
    laneHatbands: c.laneHatbands ?? [],
    cardsEnabled: (() => {
      try { return localStorage.getItem(`mg.cardsEnabled.${c.id}`) === '1'; } catch { return false; }
    })(),
  };
}

/** Race sessions that already have heats: they keep their real times, and the estimate works around them. */
export function realFixedItems(c: CompetitionDetail | null): FixedItem[] {
  if (!c) return [];
  const timings = computeTimings(c.sessions);
  return c.sessions.flatMap((s) => {
    if (kindOf(s) !== 0 || s.heats.length === 0 || !s.scheduledStart) return [];
    const start = new Date(s.scheduledStart);
    return [{ start, end: timings.get(s.id)?.effectiveEnd ?? start, arena: s.arenaName?.trim() ?? '' }];
  });
}

/** Teams entered, by section id. */
export function teamCountsOf(c: CompetitionDetail | null): Record<number, number> {
  const out: Record<number, number> = {};
  for (const t of c?.teams ?? []) if (!t.isWithdrawn) out[t.competitionSectionId] = (out[t.competitionSectionId] ?? 0) + 1;
  return out;
}

/**
 * A past competition as the start of a new one: every step filled in, the dates left empty, and nothing that belongs to the
 * old event (its saved ids, heats, scores, entries or breaks).
 */
export function copyOfCompetition(c: CompetitionDetail): CreatorDraft {
  const old = draftFromCompetition(c);
  return {
    ...old,
    startDate: '', endDate: '',
    // The governing body gives each event its own number; the venue and contact carry over.
    competitionNumber: '',
    startFrom: 'copy', copiedFrom: c.name,
    breaks: [],
    sections: old.sections.map((s): SectionDraft => ({
      ...withoutSavedIds(s),
      sessions: s.sessions.map((x) => ({ races: x.races })),
    })),
  };
}

/** An age group with everything that ties it to a saved one taken off. */
function withoutSavedIds(s: SectionDraft): SectionDraft {
  const copy: SectionDraft = { ...s };
  delete copy.existingId;
  delete copy.finalSessionId;
  delete copy.finalHasHeats;
  delete copy.finalScored;
  delete copy.hasEntries;
  return copy;
}
