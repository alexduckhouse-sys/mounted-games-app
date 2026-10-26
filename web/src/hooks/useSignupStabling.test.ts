import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import {
  fetchCompetitionStabling,
  updateSignupStabling,
  useSignupStablingAllocator,
} from './useSignupStabling';

describe('useSignupStabling', () => {
  it('calls PUT /competitions/:id/signups/:signupId/stabling and GET /competitions/:id/stabling', async () => {
    const putSpy = vi.spyOn(api, 'put').mockResolvedValueOnce({
      data: {
        id: 12,
        competitionSectionId: 4,
        sectionName: 'Open Teams',
        fullName: 'Jamie Carter',
        amountMinor: 12000,
        status: 1,
        createdAt: '2026-07-01T10:00:00Z',
        stableAssignment: 'Barn B, Boxes 14–18',
        hookupAssignment: 'Hook-up Post 4',
        vehicleRegistration: 'AB12 CDE',
      },
    });
    const getSpy = vi.spyOn(api, 'get').mockResolvedValueOnce({
      data: {
        totalStables: 5,
        bookings: [
          {
            signupId: 12,
            sectionId: 4,
            sectionName: 'Open Teams',
            fullName: 'Jamie Carter',
            ponyClubOrTeam: 'Warwickshire Hunt',
            stablesCount: 5,
            status: 1,
            stableAssignment: 'Barn B, Boxes 14–18',
            hookupAssignment: 'Hook-up Post 4',
          },
        ],
      },
    });

    const updated = await updateSignupStabling(9, 12, {
      stableAssignment: 'Barn B, Boxes 14–18',
      hookupAssignment: 'Hook-up Post 4',
      vehicleRegistration: 'AB12 CDE',
    });
    expect(putSpy).toHaveBeenCalledWith('/competitions/9/signups/12/stabling', {
      stableAssignment: 'Barn B, Boxes 14–18',
      hookupAssignment: 'Hook-up Post 4',
      vehicleRegistration: 'AB12 CDE',
    });
    expect(updated.stableAssignment).toBe('Barn B, Boxes 14–18');

    const summary = await fetchCompetitionStabling(9);
    expect(getSpy).toHaveBeenCalledWith('/competitions/9/stabling');
    expect(summary.totalStables).toBe(5);

    putSpy.mockRestore();
    getSpy.mockRestore();
  });

  it('tracks savingSignupId and error state in useSignupStablingAllocator', async () => {
    const putSpy = vi
      .spyOn(api, 'put')
      .mockResolvedValueOnce({
        data: {
          id: 15,
          competitionSectionId: 4,
          sectionName: 'Open Teams',
          fullName: 'Robin Page',
          amountMinor: 10000,
          status: 0,
          createdAt: '2026-07-01T10:00:00Z',
          stableAssignment: 'Barn A, Box 2',
        },
      })
      .mockRejectedValueOnce({
        response: { data: { message: 'Server busy' } },
      })
      .mockRejectedValueOnce(new Error('Network down'));

    const { result } = renderHook(() => useSignupStablingAllocator(7));
    expect(result.current.savingSignupId).toBeNull();
    expect(result.current.error).toBeNull();

    let saved: Awaited<ReturnType<typeof result.current.saveStabling>> = null;
    await act(async () => {
      saved = await result.current.saveStabling(15, { stableAssignment: 'Barn A, Box 2' });
    });
    expect(saved).toMatchObject({ id: 15, stableAssignment: 'Barn A, Box 2' });
    expect(result.current.savingSignupId).toBeNull();
    expect(result.current.error).toBeNull();

    await act(async () => {
      saved = await result.current.saveStabling(15, { stableAssignment: 'Barn C' });
    });
    expect(saved).toBeNull();
    expect(result.current.error).toBe('Server busy');

    await act(async () => {
      saved = await result.current.saveStabling(15, { stableAssignment: 'Barn D' });
    });
    expect(saved).toBeNull();
    expect(result.current.error).toBe('Could not save the stabling allocation. Please try again.');

    putSpy.mockRestore();
  });
});
