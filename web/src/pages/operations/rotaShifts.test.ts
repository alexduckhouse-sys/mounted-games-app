import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import {
  claimVolunteerShift, createVolunteerShift, deleteVolunteerShift, fetchVolunteerShifts, groupShiftsBySession, isRotaShift,
  rotaSummaryText, unclaimVolunteerShift, unfilledShareText, unfilledShifts, updateVolunteerShift,
} from './rotaShifts';
import type { VolunteerShift } from '../../types';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

const shift = (over: Partial<VolunteerShift> = {}): VolunteerShift => ({
  id: 1, competitionId: 7, role: 'Ring Crew', requiredCount: 2, claimedCount: 1, remainingCount: 1, isFilled: false, claims: [], ...over,
});
const sessions = [{ id: 10, name: 'Session 1', orderIndex: 1 }, { id: 11, name: 'Session 2', orderIndex: 2 }];

describe('isRotaShift', () => {
  it('keeps general shifts and leaves duties to the duty board', () => {
    expect(isRotaShift(shift())).toBe(true);
    expect(isRotaShift(shift({ dutyCategory: 'General' }))).toBe(true);
    expect(isRotaShift(shift({ dutyCategory: 'LineSteward' }))).toBe(false);
    expect(isRotaShift(shift({ assignedTeamId: 4 }))).toBe(false);
    expect(isRotaShift(shift({ assignedClubName: 'Hill Pony Club' }))).toBe(false);
  });
});

describe('groupShiftsBySession', () => {
  it('puts whole-event shifts first and sessions in running order', () => {
    const groups = groupShiftsBySession([shift({ id: 1, sessionId: 11 }), shift({ id: 2 }), shift({ id: 3, sessionId: 10 }), shift({ id: 4, sessionId: 99, sessionName: 'Old one' }), shift({ id: 5, sessionId: 98 })], sessions);
    expect(groups.map((g) => g.title)).toEqual(['Whole event', 'Session 1', 'Session 2', 'Old one', 'Session']);
  });
  it('keeps shifts together under one heading', () => {
    expect(groupShiftsBySession([shift({ id: 1, sessionId: 10 }), shift({ id: 2, sessionId: 10 })], sessions)[0].shifts).toHaveLength(2);
  });
});

describe('unfilled list', () => {
  it('lists shifts with places left', () => {
    expect(unfilledShifts([shift(), shift({ id: 2, isFilled: true, remainingCount: 0 })]).map((s) => s.id)).toEqual([1]);
  });
  it('writes a share message with roles and times but no names', () => {
    const text = unfilledShareText('Spring Games', [
      shift({ sessionId: 10, startTimeLabel: '9:30', claims: [{ id: 1, shiftId: 1, userId: 'u', volunteerName: 'Pat Private', claimedAt: '' }] }),
      shift({ id: 2, role: 'Tack Steward', remainingCount: 3 }),
    ], sessions, 'https://x.test/competitions/7/volunteers');
    expect(text).toContain('Spring Games: we still need volunteers');
    expect(text).toContain('Ring Crew, 9:30: 1 place left');
    expect(text).toContain('Tack Steward: 3 places left');
    expect(text).toContain('Sign up here: https://x.test/competitions/7/volunteers');
    expect(text).not.toContain('Pat Private');
  });
  it('says so when everything is covered', () => {
    expect(unfilledShareText('Spring Games', [shift({ isFilled: true, remainingCount: 0 })], sessions, 'x')).toContain('every volunteer shift is covered');
  });
});

describe('rotaSummaryText', () => {
  it('summarises places and shifts', () => {
    expect(rotaSummaryText([])).toBe('No shifts yet');
    expect(rotaSummaryText([shift()])).toBe('1 of 2 places taken, 1 shift needs people');
    expect(rotaSummaryText([shift(), shift({ id: 2 })])).toBe('2 of 4 places taken, 2 shifts need people');
    expect(rotaSummaryText([shift({ claimedCount: 2, remainingCount: 0, isFilled: true })])).toBe('2 of 2 places taken, every shift is covered');
  });
});

describe('API calls', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({ data: [shift()] });
    vi.mocked(api.post).mockResolvedValue({ data: shift() });
    vi.mocked(api.put).mockResolvedValue({ data: shift() });
    vi.mocked(api.delete).mockResolvedValue({ data: shift() });
  });
  it('reads, creates, updates and deletes shifts', async () => {
    expect(await fetchVolunteerShifts(7)).toHaveLength(1);
    expect(api.get).toHaveBeenCalledWith('/competitions/7/volunteer-shifts');
    await createVolunteerShift(7, { role: 'Ring Crew' });
    expect(api.post).toHaveBeenCalledWith('/competitions/7/volunteer-shifts', { role: 'Ring Crew' });
    await updateVolunteerShift(7, 3, { role: 'Ring Crew' });
    expect(api.put).toHaveBeenCalledWith('/competitions/7/volunteer-shifts/3', { role: 'Ring Crew' });
    await deleteVolunteerShift(7, 3);
    expect(api.delete).toHaveBeenCalledWith('/competitions/7/volunteer-shifts/3');
  });
  it('claims and releases a place', async () => {
    await claimVolunteerShift(7, 3);
    expect(api.post).toHaveBeenCalledWith('/competitions/7/volunteer-shifts/3/claim', {});
    await unclaimVolunteerShift(7, 3, 9);
    expect(api.delete).toHaveBeenCalledWith('/competitions/7/volunteer-shifts/3/claims/9');
  });
  it('refuses a reply that is not a list', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: '<html>' });
    await expect(fetchVolunteerShifts(7)).rejects.toThrow('Unexpected response');
  });
});
