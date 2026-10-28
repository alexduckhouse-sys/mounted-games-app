import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../api';
import { defaultDraft, defaultSection, type SectionDraft } from '../../../lib/creatorDraft';
import type { CompetitionDetail } from '../../../types';
import { finalListsOf, saveCreator } from './save';

vi.mock('../../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

const section = (over: Partial<SectionDraft>): SectionDraft => ({ ...defaultSection(), ...over });

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
    const draft = { ...defaultDraft(new Date('2026-06-01T08:00:00Z')), sections: [], breaks: [{ existingId: 7, kind: 1, name: ' Lunch ', date: '2026-06-01', time: '12:30', minutes: '45', arena: ' Ring 2 ' }] };
    const competition = { id: 3, isActive: true, isArchived: false, sections: [], teams: [], sessions: [{ id: 7, name: 'Lunch', isBreak: true, kind: 1 }] } as unknown as CompetitionDetail;
    await saveCreator(draft, { editingId: 3, competition, teamCounts: {}, progress: () => {} });
    const call = vi.mocked(api.put).mock.calls.find(([url]) => url === '/competitions/3/sessions/7');
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ name: 'Lunch', arenaName: 'Ring 2', durationMinutes: 45 });
    expect((call![1] as { scheduledStart?: string }).scheduledStart).toEqual(expect.any(String));
    expect(api.post).not.toHaveBeenCalledWith('/competitions/3/sessions', expect.anything());
    expect(api.delete).not.toHaveBeenCalled();
  });
});
