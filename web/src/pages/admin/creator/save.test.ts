import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../api';
import { defaultDraft, defaultSection, type CreatorDraft, type SectionDraft } from '../../../lib/creatorDraft';
import type { CompetitionDetail } from '../../../types';
import { finalListsOf, SaveError, saveCreator } from './save';

vi.mock('../../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

const section = (over: Partial<SectionDraft>): SectionDraft => ({ ...defaultSection(), ...over });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Drain promise continuations only: HTTP requests below stay under the test's control.
const flushPromises = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

describe('saveCreator independent writes', () => {
  beforeEach(() => {
    vi.mocked(api.put).mockResolvedValue({ data: {} });
    vi.mocked(api.delete).mockResolvedValue({ data: {} });
    vi.mocked(api.post).mockResolvedValue({ data: { id: 3 } });
  });

  const draftWith = (sections: SectionDraft[]): CreatorDraft => ({ ...defaultDraft(new Date('2026-06-01T08:00:00Z')), sections, breaks: [] });
  const options = () => ({ editingId: 3, competition: null, teamCounts: {}, progress: vi.fn() });

  it('caps section writes at three and keeps section IDs linked to draft order when replies arrive out of order', async () => {
    const pending = Array.from({ length: 4 }, () => deferred<{ data: { id: number } }>());
    let started = 0;
    vi.mocked(api.post).mockImplementation((url) => url.endsWith('/sections')
      ? pending[started++].promise
      : Promise.resolve({ data: { id: 100 } }));
    const draft = draftWith(['Alpha', 'Beta', 'Gamma', 'Delta'].map((ageGroup) => section({ ageGroup, hasFinal: false })));
    const saving = saveCreator(draft, options());
    await flushPromises();
    expect(started).toBe(3);
    expect(vi.mocked(api.post).mock.calls.every(([url]) => url.endsWith('/sections'))).toBe(true);
    pending[2].resolve({ data: { id: 30 } });
    await flushPromises();
    expect(started).toBe(4);
    pending[3].resolve({ data: { id: 40 } });
    pending[0].resolve({ data: { id: 10 } });
    await flushPromises();
    expect(vi.mocked(api.post).mock.calls.every(([url]) => url.endsWith('/sections'))).toBe(true);
    pending[1].resolve({ data: { id: 20 } });
    expect(await saving).toBe(3);
    const sessions = vi.mocked(api.post).mock.calls.filter(([url]) => url.endsWith('/sessions'));
    expect(sessions.map(([, body]) => (body as { competitionSectionId: number }).competitionSectionId)).toEqual([10, 20, 30, 40]);
    expect(sessions.map(([, body]) => (body as { orderIndex: number }).orderIndex)).toEqual([1, 2, 3, 4]);
  });

  it('stops scheduling after the first error and waits for already sent sections before exposing SaveError', async () => {
    const pending = Array.from({ length: 3 }, () => deferred<{ data: { id: number } }>());
    let started = 0;
    vi.mocked(api.post).mockImplementation((url) => url === '/competitions'
      ? Promise.resolve({ data: { id: 55 } }) : pending[started++].promise);
    const opts = { ...options(), editingId: null };
    const draft = draftWith(Array.from({ length: 5 }, (_, i) => section({ ageGroup: `Group ${i}`, hasFinal: false })));
    let settled = false;
    const outcome = saveCreator(draft, opts).then(() => { settled = true; return null; }, (error: unknown) => { settled = true; return error; });
    await flushPromises();
    pending[1].reject({ response: { status: 409, data: { message: 'Section is locked.' } } });
    await flushPromises();
    expect(started).toBe(3);
    expect(settled).toBe(false);
    pending[0].resolve({ data: { id: 10 } });
    pending[2].reject(new Error('later failure'));
    const error = await outcome;
    expect(error).toBeInstanceOf(SaveError);
    expect(error).toMatchObject({ competitionId: 55, status: 409, message: expect.stringContaining('Section is locked.') });
    expect(started).toBe(3);
    expect(api.put).not.toHaveBeenCalled();
    expect(vi.mocked(api.post).mock.calls.some(([url]) => url.endsWith('/sessions'))).toBe(false);
    expect(opts.progress).toHaveBeenCalledTimes(4);
  });

  it('bounds new-session jobs until their own lane settings have finished', async () => {
    const pending = Array.from({ length: 5 }, () => deferred<{ data: { id: number } }>());
    const settings = Array.from({ length: 5 }, () => deferred<{ data: object }>());
    let started = 0;
    vi.mocked(api.post).mockImplementation(() => pending[started++].promise);
    vi.mocked(api.put).mockImplementation((url) => {
      const match = /sessions\/(\d+)\/settings$/.exec(url);
      return match ? settings[Number(match[1]) - 20].promise : Promise.resolve({ data: {} });
    });
    const draft = draftWith([section({ existingId: 9, hasFinal: false, laneRotation: 2, minutesPerRace: '7', sessions: Array.from({ length: 5 }, () => ({ races: ['Mug'] })) })]);
    const saving = saveCreator(draft, options());
    await flushPromises();
    expect(started).toBe(3);
    pending[1].resolve({ data: { id: 21 } });
    await flushPromises();
    expect(started).toBe(3);
    expect(api.put).toHaveBeenCalledWith('/competitions/3/sessions/21/settings', { laneRotationMode: 2, minutesPerHeat: 7 });
    settings[1].resolve({ data: {} });
    await flushPromises();
    expect(started).toBe(4);
    pending[2].resolve({ data: { id: 22 } });
    await flushPromises();
    expect(started).toBe(4);
    settings[2].resolve({ data: {} });
    await flushPromises();
    expect(started).toBe(5);
    pending[3].resolve({ data: { id: 23 } });
    pending[4].resolve({ data: { id: 24 } });
    await flushPromises();
    expect(vi.mocked(api.put).mock.calls.filter(([url]) => url.endsWith('/settings'))).toHaveLength(4);
    pending[0].resolve({ data: { id: 20 } });
    settings[0].resolve({ data: {} });
    settings[3].resolve({ data: {} });
    settings[4].resolve({ data: {} });
    await saving;
    expect(vi.mocked(api.put).mock.calls.filter(([url]) => url.endsWith('/settings')).map(([url]) => url)).toEqual(
      [21, 22, 23, 24, 20].map((id) => `/competitions/3/sessions/${id}/settings`),
    );
  });

  it('finishes settings for successful in-flight creates after a sibling fails without starting new creates or finals', async () => {
    const pending = Array.from({ length: 3 }, () => deferred<{ data: { id: number } }>());
    const settings = Array.from({ length: 2 }, () => deferred<{ data: object }>());
    let started = 0;
    vi.mocked(api.post).mockImplementation(() => pending[started++].promise);
    vi.mocked(api.put).mockImplementation((url) => {
      const match = /sessions\/(\d+)\/settings$/.exec(url);
      return match ? settings[Number(match[1]) - 21].promise : Promise.resolve({ data: {} });
    });
    const draft = draftWith([section({ existingId: 9, laneRotation: 2, finalRaces: ['Flag'], sessions: Array.from({ length: 5 }, () => ({ races: ['Mug'] })) })]);
    let settled = false;
    const outcome = saveCreator(draft, options()).catch((error: unknown) => { settled = true; return error; });
    await flushPromises();
    pending[0].reject(new Error('Connection dropped'));
    await flushPromises();
    pending[1].resolve({ data: { id: 21 } });
    pending[2].resolve({ data: { id: 22 } });
    await flushPromises();
    expect(vi.mocked(api.put).mock.calls.filter(([url]) => url.endsWith('/settings')).map(([url]) => url)).toEqual(
      [21, 22].map((id) => `/competitions/3/sessions/${id}/settings`),
    );
    expect(settled).toBe(false);
    settings[0].resolve({ data: {} });
    await flushPromises();
    expect(settled).toBe(false);
    settings[1].resolve({ data: {} });
    expect(await outcome).toMatchObject({ competitionId: 3, status: null });
    expect(started).toBe(3);
  });

  it('preserves the chosen minutes when saving lane settings on an existing session', async () => {
    const draft = draftWith([section({ existingId: 9, hasFinal: false, laneRotation: 0, minutesPerRace: '8', sessions: [{ existingId: 20, races: ['Mug'] }] })]);
    await saveCreator(draft, options());
    expect(api.put).toHaveBeenCalledWith('/competitions/3/sessions/20/settings', { laneRotationMode: 0, minutesPerHeat: 8 });
  });

  it('preserves protected sessions and gives new finals and breaks stable timetable positions', async () => {
    const draft = draftWith([
      section({ existingId: 8, finalScored: true, finalSessionId: 80, sessions: [{ existingId: 81, scored: true, races: ['Mug'] }] }),
      section({ existingId: 9, finalRaces: ['Flag'], sessions: [] }),
      section({ existingId: 10, finalRaces: ['Relay'], sessions: [] }),
    ]);
    draft.breaks = [{ kind: 1 as const, name: 'Lunch', date: '2026-06-01', time: '12:00', minutes: '30', arena: '' }];
    await saveCreator(draft, options());
    expect(vi.mocked(api.put).mock.calls.some(([url]) => /sessions\/(80|81)/.test(url))).toBe(false);
    const bodies = vi.mocked(api.post).mock.calls.map(([, body]) => body as { competitionSectionId: number | null; orderIndex: number });
    expect(bodies.map((body) => body.competitionSectionId)).toEqual([9, 10, null]);
    expect(new Set(bodies.map((body) => body.orderIndex)).size).toBe(3);
    expect(bodies[1].orderIndex).toBe(bodies[0].orderIndex + 1);
  });
});

describe('finalListsOf', () => {
  it('returns the B and C lists for the finals the age group has', () => {
    const s = section({ maxParticipants: '20', maxTeamsPerHeat: '6', finalRacesB: ['Mug'], finalRacesC: ['Relay'] });
    expect(finalListsOf(s)).toEqual({ B: ['Mug'], C: ['Relay'] });
  });

  it('leaves out lists for finals that do not exist, and empty lists', () => {
    expect(finalListsOf(section({ maxParticipants: '12', maxTeamsPerHeat: '6', finalRacesB: ['Mug'], finalRacesC: ['Relay'] }))).toEqual({ B: ['Mug'] });
    expect(finalListsOf(section({ maxParticipants: '6', maxTeamsPerHeat: '6', finalRacesB: ['Mug'] }))).toEqual({});
    expect(finalListsOf(section({ maxParticipants: '20', maxTeamsPerHeat: '6', finalRacesB: [], finalRacesC: null }))).toEqual({});
  });

  it('is empty when the age group has no final', () => {
    expect(finalListsOf(section({ hasFinal: false, maxParticipants: '20', maxTeamsPerHeat: '6', finalRacesB: ['Mug'] }))).toEqual({});
  });
});

describe('saveCreator existing breaks', () => {
  beforeEach(() => {
    vi.mocked(api.put).mockReset().mockResolvedValue({ data: {} });
    vi.mocked(api.post).mockReset().mockResolvedValue({ data: {} });
    vi.mocked(api.delete).mockReset().mockResolvedValue({ data: {} });
  });

  it('saves edits to a break that already exists instead of skipping it', async () => {
    const draft = { ...defaultDraft(new Date('2026-06-01T08:00:00Z')), sections: [], breaks: [{ existingId: 7, kind: 1 as const, name: ' Lunch ', date: '2026-06-01', time: '12:30', minutes: '45', arena: ' Ring 2 ' }] };
    const competition = { id: 3, isActive: true, isArchived: false, sections: [], teams: [], sessions: [{ id: 7, name: 'Lunch', isBreak: true, kind: 1 }] } as unknown as CompetitionDetail;
    await saveCreator(draft, { editingId: 3, competition, teamCounts: {}, progress: () => {} });
    const call = vi.mocked(api.put).mock.calls.find(([url]) => url === '/competitions/3/sessions/7');
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ name: 'Lunch', arenaName: 'Ring 2', durationMinutes: 45 });
    expect((call![1] as { scheduledStart?: string }).scheduledStart).toEqual(expect.any(String));
    expect(api.post).not.toHaveBeenCalledWith('/competitions/3/sessions', expect.anything());
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('sends isIndoor on competition create and update', async () => {
    const draft = { ...defaultDraft(new Date('2026-06-01T08:00:00Z')), name: 'Winter Indoor', isIndoor: true, sections: [], breaks: [] };
    vi.mocked(api.post).mockResolvedValueOnce({ data: { id: 12 } });
    await saveCreator(draft, { editingId: null, competition: null, teamCounts: {}, progress: () => {} });
    expect(api.post).toHaveBeenCalledWith('/competitions', expect.objectContaining({ name: 'Winter Indoor', isIndoor: true }));
  });
});
