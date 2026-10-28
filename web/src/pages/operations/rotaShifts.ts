import { api } from '../../api';
import { tr } from '../../i18n/translate';
import { volunteerShiftSummary } from '../../lib/lorryAndVolunteers';
import type { ClaimVolunteerShiftInput, CreateVolunteerShiftInput, Session, VolunteerShift } from '../../types';

/** Steward and arena crew duties belong to the duty board. The rota is everything else. */
export function isRotaShift(shift: VolunteerShift): boolean {
  const general = !shift.dutyCategory || shift.dutyCategory === 'General';
  return general && shift.assignedTeamId == null && !shift.assignedClubName?.trim();
}

export interface RotaGroup { key: string; title: string; shifts: VolunteerShift[] }

/** Shifts under the session they belong to, in the session running order, with whole-event shifts first. */
export function groupShiftsBySession(shifts: readonly VolunteerShift[], sessions: readonly Pick<Session, 'id' | 'name' | 'orderIndex'>[]): RotaGroup[] {
  const order = new Map(sessions.map((s) => [s.id, s]));
  const groups = new Map<string, RotaGroup>();
  for (const shift of shifts) {
    const key = shift.sessionId == null ? 'event' : `s${shift.sessionId}`;
    const title = shift.sessionId == null ? tr('site.volunteers.wholeEvent') : order.get(shift.sessionId)?.name ?? shift.sessionName?.trim() ?? tr('site.volunteers.session');
    const group = groups.get(key) ?? { key, title, shifts: [] };
    group.shifts.push(shift);
    groups.set(key, group);
  }
  const rank = (group: RotaGroup) => (group.key === 'event' ? -1 : order.get(Number(group.key.slice(1)))?.orderIndex ?? Number.MAX_SAFE_INTEGER);
  return [...groups.values()].sort((a, b) => rank(a) - rank(b));
}

/** Shifts that still need people, in the order given. */
export function unfilledShifts(shifts: readonly VolunteerShift[]): VolunteerShift[] {
  return shifts.filter((shift) => !shift.isFilled && shift.remainingCount > 0);
}

/** A message for a group chat asking for help with the shifts that are not full. Roles and times only, no names. */
export function unfilledShareText(eventName: string, shifts: readonly VolunteerShift[], sessions: readonly Pick<Session, 'id' | 'name' | 'orderIndex'>[], link: string): string {
  const open = unfilledShifts(shifts);
  if (open.length === 0) return `${eventName}: every volunteer shift is covered. Thank you.`;
  const lines = [`${eventName}: we still need volunteers`];
  for (const group of groupShiftsBySession(open, sessions)) {
    lines.push('', group.title);
    for (const shift of group.shifts) {
      const when = shift.startTimeLabel?.trim() ? `, ${shift.startTimeLabel.trim()}` : '';
      lines.push(`${shift.role}${when}: ${shift.remainingCount} ${shift.remainingCount === 1 ? 'place' : 'places'} left`);
    }
  }
  lines.push('', `Sign up here: ${link}`);
  return lines.join('\n');
}

/** "14 of 20 places taken" and how many shifts still need someone. */
export function rotaSummaryText(shifts: readonly VolunteerShift[]): string {
  const summary = volunteerShiftSummary(shifts);
  if (summary.totalShifts === 0) return tr('site.volunteers.noShiftsYet');
  const need = summary.unfilledShifts === 0 ? tr('site.volunteers.allCovered') : tr('site.volunteers.shiftsNeed', { count: summary.unfilledShifts });
  return tr('site.volunteers.summary', { taken: summary.claimedSlots, total: summary.totalSlots, need });
}

// ---- the API, one call each ----

const base = (competitionId: number) => `/competitions/${competitionId}/volunteer-shifts`;

export async function fetchVolunteerShifts(competitionId: number): Promise<VolunteerShift[]> {
  const { data } = await api.get<VolunteerShift[]>(base(competitionId));
  if (!Array.isArray(data)) throw new Error('Unexpected response');
  return data;
}

export const createVolunteerShift = async (competitionId: number, input: CreateVolunteerShiftInput): Promise<VolunteerShift> =>
  (await api.post<VolunteerShift>(base(competitionId), input)).data;

export const updateVolunteerShift = async (competitionId: number, shiftId: number, input: CreateVolunteerShiftInput): Promise<VolunteerShift> =>
  (await api.put<VolunteerShift>(`${base(competitionId)}/${shiftId}`, input)).data;

export const deleteVolunteerShift = async (competitionId: number, shiftId: number): Promise<void> => {
  await api.delete(`${base(competitionId)}/${shiftId}`);
};

export const claimVolunteerShift = async (competitionId: number, shiftId: number, input: ClaimVolunteerShiftInput = {}): Promise<VolunteerShift> =>
  (await api.post<VolunteerShift>(`${base(competitionId)}/${shiftId}/claim`, input)).data;

export const unclaimVolunteerShift = async (competitionId: number, shiftId: number, claimId: number): Promise<VolunteerShift> =>
  (await api.delete<VolunteerShift>(`${base(competitionId)}/${shiftId}/claims/${claimId}`)).data;
