// Unused in web UI yet — reserved for iOS / upcoming wiring
import type { CompetitionDetail, EmergencyContactEntry, VolunteerShift } from '../types';

export const VOLUNTEER_ROLE_PRESETS = [
  'Ring Crew',
  'Line Judge',
  'Collecting Ring',
  'Tack Steward',
  'Gate Steward',
  'First Aid Liaison',
] as const;

export const STEWARD_DUTY_ROLE_PRESETS = [
  { role: 'Arena Crew (Centre Props)', dutyCategory: 'ArenaCrew', laneNumber: null },
  { role: 'Start/Finish Line Steward — Lane 1', dutyCategory: 'LineSteward', laneNumber: 1 },
  { role: 'Start/Finish Line Steward — Lane 2', dutyCategory: 'LineSteward', laneNumber: 2 },
  { role: 'Start/Finish Line Steward — Lane 3', dutyCategory: 'LineSteward', laneNumber: 3 },
  { role: 'Start/Finish Line Steward — Lane 4', dutyCategory: 'LineSteward', laneNumber: 4 },
  { role: 'Start/Finish Line Steward — Lane 5', dutyCategory: 'LineSteward', laneNumber: 5 },
  { role: 'Changeover Line Steward — Lane 1', dutyCategory: 'ChangeoverSteward', laneNumber: 1 },
  { role: 'Changeover Line Steward — Lane 2', dutyCategory: 'ChangeoverSteward', laneNumber: 2 },
  { role: 'Changeover Line Steward — Lane 3', dutyCategory: 'ChangeoverSteward', laneNumber: 3 },
  { role: 'Changeover Line Steward — Lane 4', dutyCategory: 'ChangeoverSteward', laneNumber: 4 },
  { role: 'Changeover Line Steward — Lane 5', dutyCategory: 'ChangeoverSteward', laneNumber: 5 },
  { role: 'Collecting Ring Steward', dutyCategory: 'General', laneNumber: null },
] as const;

export interface LorryGateLinks {
  hasDirections: boolean;
  what3WordsDisplay: string | null;
  what3WordsUrl: string | null;
  googleMapsUrl: string | null;
  appleMapsUrl: string | null;
  directionsNote: string | null;
}

export function cleanWhat3Words(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim().replace(/^\/+/, '').trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

export function lorryGateLinks(
  competition: Pick<CompetitionDetail, 'lorryWhat3Words' | 'lorryLatitude' | 'lorryLongitude' | 'lorryDirectionsNote'>,
): LorryGateLinks {
  const w3w = cleanWhat3Words(competition.lorryWhat3Words);
  const lat = competition.lorryLatitude;
  const lon = competition.lorryLongitude;
  const hasCoords = typeof lat === 'number' && Number.isFinite(lat) && typeof lon === 'number' && Number.isFinite(lon);
  const note = competition.lorryDirectionsNote?.trim() || null;

  return {
    hasDirections: w3w !== null || hasCoords || note !== null,
    what3WordsDisplay: w3w ? `///${w3w}` : null,
    what3WordsUrl: w3w ? `https://what3words.com/${encodeURIComponent(w3w)}` : null,
    googleMapsUrl: hasCoords ? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}` : null,
    appleMapsUrl: hasCoords ? `https://maps.apple.com/?ll=${lat},${lon}&q=${encodeURIComponent('Horsebox & Lorry Gate')}` : null,
    directionsNote: note,
  };
}

export interface VolunteerShiftSummary {
  totalShifts: number;
  unfilledShifts: number;
  totalSlots: number;
  claimedSlots: number;
  openSlots: number;
}

export function filterVolunteerShifts(
  shifts: readonly VolunteerShift[],
  options?: { unfilledOnly?: boolean; arenaName?: string | null },
): VolunteerShift[] {
  const unfilledOnly = Boolean(options?.unfilledOnly);
  const arenaFilter = options?.arenaName?.trim().toLowerCase() || null;
  return shifts.filter((shift) => {
    if (unfilledOnly && (shift.isFilled || shift.remainingCount <= 0)) return false;
    if (arenaFilter && (shift.arenaName?.trim().toLowerCase() ?? '') !== arenaFilter) return false;
    return true;
  });
}

export function volunteerShiftSummary(shifts: readonly VolunteerShift[]): VolunteerShiftSummary {
  let unfilledShifts = 0;
  let totalSlots = 0;
  let claimedSlots = 0;
  let openSlots = 0;
  for (const shift of shifts) {
    const required = Math.max(0, shift.requiredCount);
    const claimed = Math.max(0, shift.claimedCount);
    const remaining = Math.max(0, required - claimed);
    if (!shift.isFilled && remaining > 0) unfilledShifts += 1;
    totalSlots += required;
    claimedSlots += claimed;
    openSlots += remaining;
  }
  return {
    totalShifts: shifts.length,
    unfilledShifts,
    totalSlots,
    claimedSlots,
    openSlots,
  };
}

export function telHref(phone: string | null | undefined): string | null {
  const raw = phone?.trim() ?? '';
  if (!raw) return null;
  const cleaned = raw.replace(/(?!^\+)[^\d]/g, '');
  const digitsOnly = cleaned.replace(/\D/g, '');
  if (digitsOnly.length === 0) return null;
  return `tel:${cleaned}`;
}

export function filterEmergencyContacts(
  entries: readonly EmergencyContactEntry[],
  query: string | null | undefined,
): EmergencyContactEntry[] {
  const tokens = (query ?? '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return [...entries];

  return entries.filter((entry) => {
    const haystack = [
      entry.riderName,
      entry.ponyName,
      entry.teamName,
      entry.sectionName,
      entry.clubName,
      entry.bibColour,
      entry.bibDescription,
      entry.emergencyContactName,
      entry.trainerName,
    ]
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .join(' ')
      .toLowerCase();

    return tokens.every((token) => haystack.includes(token));
  });
}

export interface SessionStewardDutySummary {
  totalDuties: number;
  hereCount: number;
  missingCount: number;
  assignedAwaitingCheckInCount: number;
  allHere: boolean;
  readinessLabel: string;
}

export function isShiftCheckedInHere(shift: Pick<VolunteerShift, 'attendanceStatus'>): boolean {
  return (shift.attendanceStatus ?? 'Assigned').toLowerCase() === 'here';
}

export function isShiftMarkedMissing(shift: Pick<VolunteerShift, 'attendanceStatus'>): boolean {
  return (shift.attendanceStatus ?? 'Assigned').toLowerCase() === 'missing';
}

export function missingStewardShifts(
  shifts: readonly VolunteerShift[],
  sessionId?: number | null,
): VolunteerShift[] {
  return shifts.filter((shift) => {
    if (sessionId != null && shift.sessionId !== sessionId) return false;
    return !isShiftCheckedInHere(shift);
  });
}

export function myTeamAssignedDuties(
  shifts: readonly VolunteerShift[],
  myTeamIds: readonly number[],
  myClubName?: string | null,
): VolunteerShift[] {
  const teamSet = new Set(myTeamIds);
  const cleanClub = myClubName?.trim().toLowerCase() || null;
  return shifts.filter((shift) => {
    if (shift.canViewerCheckIn) return true;
    if (shift.assignedTeamId != null && teamSet.has(shift.assignedTeamId)) return true;
    if (cleanClub && (shift.assignedClubName?.trim().toLowerCase() ?? '') === cleanClub) return true;
    return false;
  });
}

export function sessionStewardDutySummary(
  shifts: readonly VolunteerShift[],
  sessionId?: number | null,
): SessionStewardDutySummary {
  const relevant = sessionId == null ? shifts : shifts.filter((s) => s.sessionId === sessionId);
  let hereCount = 0;
  let missingCount = 0;
  let assignedAwaitingCheckInCount = 0;

  for (const s of relevant) {
    if (isShiftCheckedInHere(s)) {
      hereCount += 1;
    } else if (isShiftMarkedMissing(s)) {
      missingCount += 1;
    } else {
      assignedAwaitingCheckInCount += 1;
    }
  }

  const totalDuties = relevant.length;
  const allHere = totalDuties > 0 && hereCount === totalDuties;
  const notHereCount = totalDuties - hereCount;
  const readinessLabel =
    totalDuties === 0
      ? 'No duties assigned'
      : allHere
        ? `All ${totalDuties} stewards here`
        : `${hereCount}/${totalDuties} here · ${notHereCount} not checked in`;

  return {
    totalDuties,
    hereCount,
    missingCount,
    assignedAwaitingCheckInCount,
    allHere,
    readinessLabel,
  };
}
