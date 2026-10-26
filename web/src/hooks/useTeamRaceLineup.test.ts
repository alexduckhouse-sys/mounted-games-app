import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { useTeamRaceLineup } from './useTeamRaceLineup';

vi.mock('../api', () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
  },
}));

describe('useTeamRaceLineup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('loads shared race lineup from API and syncs updates via PUT /competitions/:id/teams/:teamId/race-lineup', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: {
        competitionId: 7,
        teamId: 12,
        assignments: { '201': { '101': '1', '102': '2', '103': '3', '104': '4', '105': 'sit-out' } },
        updatedAt: '2026-10-26T12:00:00Z',
      },
    } as never);
    vi.mocked(api.put).mockImplementation(async (_url, body) => ({
      data: {
        competitionId: 7,
        teamId: 12,
        assignments: (body as { assignments: Record<string, Record<string, string>> }).assignments,
        updatedAt: '2026-10-26T12:05:00Z',
      },
    } as never));

    const { result } = renderHook(() => useTeamRaceLineup(7, 12));

    await waitFor(() => {
      expect(result.current.assignments['201']?.['105']).toBe('sit-out');
    });

    await act(async () => {
      await result.current.setRaceRow('202', {
        '101': '1',
        '102': '2',
        '103': '3',
        '104': 'sit-out',
        '105': '4',
      });
    });

    expect(api.put).toHaveBeenCalledWith('/competitions/7/teams/12/race-lineup', {
      assignments: {
        '201': { '101': '1', '102': '2', '103': '3', '104': '4', '105': 'sit-out' },
        '202': { '101': '1', '102': '2', '103': '3', '104': 'sit-out', '105': '4' },
      },
    });
    expect(result.current.assignments['202']?.['104']).toBe('sit-out');
  });
});
