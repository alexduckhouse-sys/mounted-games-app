import { api } from '../../../api';
import { setCardsEnabled } from '../../competition/ScoringParts';
import {
  finalCountOf, finalSessionName, hatbandsFor, heatSizeOf, minutesOf, parseFinalistCount, parseMaxParticipants, priceGbpToMinor, sectionLocked, sectionName, type CreatorDraft, type SectionDraft,
} from '../../../lib/creatorDraft';
import { realFixedItems } from '../../../lib/creatorLoad';
import { breakWindow, plannedSessions, provisionalTimetable } from '../../../lib/creatorPlan';
import type { CompetitionDetail, Session } from '../../../types';
import { SessionKind } from '../../../types';

/** A save that stopped part way. `competitionId` is set once the competition exists, so the person can carry on in edit mode. */
export class SaveError extends Error {
  readonly competitionId: number | null;
  /** The HTTP status the API answered with, when it did. A 409 means the change isn't allowed as things stand. */
  readonly status: number | null;
  constructor(message: string, competitionId: number | null, status: number | null = null) {
    super(message);
    this.competitionId = competitionId;
    this.status = status;
  }
}

const messageOf = (e: unknown, fallback: string) => {
  const data = (e as { response?: { data?: { message?: string; title?: string } | string } }).response?.data;
  return typeof data === 'string' && data ? data : (typeof data === 'object' && (data?.message || data?.title)) || fallback;
};

export function basicsPayload(draft: CreatorDraft) {
  const start = new Date(`${draft.startDate}T${draft.startTime}`).toISOString();
  const hasEnd = draft.endDate || draft.endTime;
  return {
    name: draft.name.trim(),
    icon: draft.icon,
    location: draft.location.trim() || null,
    description: draft.description.trim() || null,
    latitude: draft.lat ? parseFloat(draft.lat) : null,
    longitude: draft.lon ? parseFloat(draft.lon) : null,
    what3Words: draft.what3Words.trim() || null,
    // Blank is sent as blank, not null: on an update, null means leave it as it is.
    postcode: draft.postcode.trim(),
    competitionNumber: draft.competitionNumber.trim(),
    contactEmail: draft.contactEmail.trim(),
    appleMapsUrl: draft.appleMapsUrl.trim() || null,
    organiserName: draft.organiserName.trim() || null,
    paymentDestination: draft.paymentDestination.trim() || null,
    termsText: draft.termsText.trim() || null,
    laneHatbands: hatbandsFor(draft),
    startDate: start,
    endDate: hasEnd ? new Date(`${draft.endDate || draft.startDate}T${draft.endTime || '17:00'}`).toISOString() : null,
  };
}

/** The B and C finals' own race lists, for the finals the age group has. An empty object clears what was saved. */
export function finalListsOf(section: SectionDraft): Record<string, string[]> {
  const finals = finalCountOf(section);
  const out: Record<string, string[]> = {};
  if (finals >= 2 && section.finalRacesB?.length) out.B = section.finalRacesB;
  if (finals >= 3 && section.finalRacesC?.length) out.C = section.finalRacesC;
  return out;
}

/**
 * Saves the draft: the competition, its age groups, their sessions (with the estimated start times that make the
 * provisional timetable) and its breaks. Never touches teams, entries, heats or results. Sessions that have heats are
 * left as they are, apart from their minutes and arena; scored ones are not changed at all.
 */
export async function saveCreator(draft: CreatorDraft, opts: {
  editingId: number | null;
  competition: CompetitionDetail | null;
  teamCounts: Readonly<Record<number, number>>;
  progress: (message: string) => void;
}): Promise<number> {
  const { editingId, competition, teamCounts, progress } = opts;
  let competitionId = editingId;
  const step = async <T>(label: string, work: () => Promise<T>): Promise<T> => {
    progress(label);
    try { return await work(); } catch (e) { throw new SaveError(`${label.replace(/…$/, '')} failed: ${messageOf(e, 'please try again')}`, competitionId, (e as { response?: { status?: number } }).response?.status ?? null); }
  };

  if (editingId === null) {
    const created = await step('Creating competition…', () => api.post<{ id: number }>('/competitions', basicsPayload(draft)));
    competitionId = created.data.id;
  } else {
    await step('Saving details…', () => api.put(`/competitions/${editingId}`, { ...basicsPayload(draft), isActive: competition?.isActive ?? true, isArchived: competition?.isArchived ?? false }));
  }
  const id = competitionId as number;
  if (draft.cardsEnabled !== undefined) {
    setCardsEnabled(id, draft.cardsEnabled);
  }
  const base = `/competitions/${id}`;
  if (editingId === null && draft.passportCheck) {
    await step('Turning on the passport check…', () => api.put(`/event-tools/competitions/${id}/passport-check/settings`, { enabled: true }));
  }

  // Age groups taken out of the draft.
  const keptSections = new Set(draft.sections.flatMap((s) => (s.existingId ? [s.existingId] : [])));
  for (const old of competition?.sections ?? []) {
    if (!keptSections.has(old.id)) await step(`Removing ${old.displayName}…`, () => api.delete(`${base}/sections/${old.id}`));
  }

  const sectionIds: number[] = [];
  for (const s of draft.sections) {
    const name = sectionName(s);
    const common = {
      runoffRaceName: s.runoffRaceName.trim() || null,
      usesRaceFinals: s.usesRaceFinals,
      priceMinor: priceGbpToMinor(s.priceGbp),
      // On an update, zero is how a cap is cleared (an omitted value leaves it as it is).
      maxParticipants: parseMaxParticipants(s.maxParticipants),
      finalistCount: parseFinalistCount(s.finalistCount),
      ...(s.tieBreak !== undefined ? { tieBreakRule: s.tieBreak } : {}),
      // Heat, heat, final has no separate final, and the API refuses these for it.
      ...(s.usesRaceFinals ? {} : { hasFinal: s.hasFinal !== false, carryPointsIntoFinal: s.carryPointsIntoFinal ?? true, doublePointsInFinal: s.doublePointsInFinal ?? false }),
    };
    if (s.existingId) {
      await step(`Saving ${name}…`, () => api.put(`${base}/sections/${s.existingId}`, { ...common, maxParticipants: common.maxParticipants ?? 0 }));
      sectionIds.push(s.existingId);
    } else {
      const made = await step(`Adding ${name}…`, () => api.post<{ id: number }>(`${base}/sections`, { format: s.format, ageGroup: s.ageGroup.trim(), displayName: name, ...common }));
      sectionIds.push(made.data.id);
    }
  }

  const setLaneRotation = (sessionId: number, laneRotationMode: number, name: string) =>
    step(`Saving lane order for ${name}…`, () => api.put(`${base}/sessions/${sessionId}/settings`, { laneRotationMode }));

  // Sessions and breaks, with the estimated times.
  const real = realFixedItems(competition);
  const plan = plannedSessions(draft, teamCounts);
  const rows = provisionalTimetable(draft, teamCounts, real).rows;
  const rank = new Map<string, number>();
  rows.forEach((row, i) => rank.set(row.planKey !== undefined ? `s${row.planKey}` : `b${row.breakKey}`, i));
  const topOrder = (competition?.sessions ?? []).reduce((m, s) => Math.max(m, s.orderIndex), 0);
  const orderOf = (key: string) => topOrder + (rank.get(key) ?? 0) + 1;

  const wantsFinals = (s: SectionDraft) =>
    !s.usesRaceFinals && s.hasFinal !== false && (Boolean(s.finalRaces && s.finalRaces.length > 0) || Object.keys(finalListsOf(s)).length > 0 || parseFinalistCount(s.finalistCount) !== null || Boolean(s.finalHasHeats) || Boolean(s.finalScored));
  const keptSessions = new Set(draft.sections.flatMap((s) => [
    ...s.sessions.flatMap((x) => (x.existingId ? [x.existingId] : [])),
    ...(s.finalSessionId && wantsFinals(s) ? [s.finalSessionId] : []),
  ]));
  const isRace = (s: Session) => (s.kind ?? (s.isBreak ? SessionKind.Break : SessionKind.Race)) === SessionKind.Race;
  for (const old of (competition?.sessions ?? []).filter(isRace)) {
    // A session of a removed age group went with it.
    if (keptSections.has(old.competitionSectionId ?? -1) && !keptSessions.has(old.id)) {
      await step(`Removing ${old.name}…`, () => api.delete(`${base}/sessions/${old.id}`));
    }
  }

  for (const p of plan) {
    const section = draft.sections[p.sectionIndex];
    const session = section.sessions[p.sessionIndex];
    const row = rows.find((r) => r.planKey === p.key);
    const minutes = minutesOf(section);
    const arena = section.arena.trim();
    if (session.existingId) {
      if (session.scored) continue;
      const body = session.hasHeats
        ? { minutesPerHeat: minutes, arenaName: arena }
        : { arenaName: arena, minutesPerHeat: minutes, lanesPerHeat: heatSizeOf(section), plannedRaces: session.races ?? [], scheduledStart: row?.start.toISOString(), durationMinutes: row && row.minutes > 0 ? row.minutes : undefined, orderIndex: orderOf(`s${p.key}`) };
      await step(`Saving ${p.name}…`, () => api.put(`${base}/sessions/${session.existingId}`, body));
      if (section.laneRotation !== undefined && !session.hasHeats) await setLaneRotation(session.existingId, section.laneRotation, p.name);
    } else {
      const made = await step(`Adding ${p.name}…`, () => api.post<{ id?: number }>(`${base}/sessions`, {
        competitionSectionId: sectionIds[p.sectionIndex], name: p.name, arenaName: arena, scheduledStart: row?.start.toISOString() ?? null,
        orderIndex: orderOf(`s${p.key}`), notes: null, isBreak: false, durationMinutes: row && row.minutes > 0 ? row.minutes : null,
        kind: SessionKind.Race, location: null, lanesPerHeat: heatSizeOf(section), minutesPerHeat: minutes, plannedRaces: session.races ?? [],
      }));
      // Move up is what every new session does already, so only another choice needs saying.
      if (section.laneRotation && made.data?.id) await setLaneRotation(made.data.id, section.laneRotation, p.name);
    }
  }

  let nextFinalOrder = topOrder + rows.length + 1;
  for (const [sectionIndex, section] of draft.sections.entries()) {
    if (section.usesRaceFinals || section.hasFinal === false) continue;
    const hasFinalRaces = Boolean(section.finalRaces && section.finalRaces.length > 0) || Object.keys(finalListsOf(section)).length > 0;
    const plannedFinalRaces = finalListsOf(section);
    const hasFinalists = parseFinalistCount(section.finalistCount) !== null;
    const fName = finalSessionName(section);
    const minutes = minutesOf(section);
    const arena = section.arena.trim();
    if (section.finalSessionId) {
      if (section.finalScored || !wantsFinals(section)) continue;
      const body = section.finalHasHeats
        ? { minutesPerHeat: minutes, arenaName: arena }
        : { arenaName: arena, minutesPerHeat: minutes, lanesPerHeat: heatSizeOf(section), plannedRaces: section.finalRaces ?? [], plannedFinalRaces };
      await step(`Saving ${fName}…`, () => api.put(`${base}/sessions/${section.finalSessionId}`, body));
    } else if (hasFinalRaces || (!sectionLocked(section) && hasFinalists)) {
      await step(`Adding ${fName}…`, () => api.post(`${base}/sessions`, {
        competitionSectionId: sectionIds[sectionIndex], name: fName, arenaName: arena, scheduledStart: null,
        orderIndex: nextFinalOrder++, notes: null, isBreak: false, durationMinutes: null,
        kind: SessionKind.Race, location: null, lanesPerHeat: heatSizeOf(section), minutesPerHeat: minutes, plannedRaces: section.finalRaces ?? [], plannedFinalRaces,
      }));
    }
  }

  const keptBreaks = new Set(draft.breaks.flatMap((b) => (b.existingId ? [b.existingId] : [])));
  for (const old of (competition?.sessions ?? []).filter((s) => !isRace(s))) {
    if (!keptBreaks.has(old.id)) await step(`Removing ${old.name}…`, () => api.delete(`${base}/sessions/${old.id}`));
  }
  for (const [i, b] of draft.breaks.entries()) {
    const window = breakWindow(b);
    if (b.existingId) {
      // The session's kind and place in the order stay; its name, time, length and arena follow the edit.
      const minutes = parseInt(b.minutes, 10);
      await step(`Saving ${b.name.trim() || 'break'}…`, () => api.put(`${base}/sessions/${b.existingId}`, {
        name: b.name.trim() || undefined, arenaName: b.arena.trim(), scheduledStart: window?.start.toISOString(),
        durationMinutes: minutes > 0 ? minutes : undefined,
      }));
      continue;
    }
    await step(`Adding ${b.name.trim() || 'break'}…`, () => api.post(`${base}/sessions`, {
      competitionSectionId: null, name: b.name.trim(), arenaName: b.arena.trim() || null, scheduledStart: window?.start.toISOString() ?? null,
      orderIndex: orderOf(`b${i}`), notes: null, isBreak: b.kind === 1, durationMinutes: parseInt(b.minutes, 10) || null,
      kind: b.kind, location: null,
    }));
  }
  return id;
}
