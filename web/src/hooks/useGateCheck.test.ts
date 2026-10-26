import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { scorerApi } from '../offline/scorerLink';
import type { Session } from '../types';
import { useGateCheck } from './useGateCheck';

vi.mock('../api', () => ({ api: { put: vi.fn() } }));
vi.mock('../offline/scorerLink', () => ({ scorerApi: { put: vi.fn() } }));

const putMock = vi.mocked(api.put);
const scorerPutMock = vi.mocked(scorerApi.put);

describe('useGateCheck', () => {
  beforeEach(() => {
    putMock.mockReset();
    scorerPutMock.mockReset();
  });

  it('cycles gate check status through staff endpoint and notifies onSessionUpdated', async () => {
    const updatedSession = { id: 5, notes: '[gate:10:101=at-gate]' } as Session;
    putMock.mockResolvedValueOnce({ data: updatedSession });
    const onSessionUpdated = vi.fn();

    const { result } = renderHook(() =>
      useGateCheck({ competitionId: 1, onSessionUpdated }),
    );

    const session = { id: 5, notes: null };
    expect(result.current.getStatus(session, 10, 101)).toBeNull();

    let returned: Session | null = null;
    await act(async () => {
      returned = await result.current.cycleStatus(session, 10, 101);
    });

    expect(putMock).toHaveBeenCalledWith(
      '/competitions/1/sessions/5/heats/10/gate-check',
      { teamId: 101, status: 'at-gate' },
    );
    expect(returned).toEqual(updatedSession);
    expect(onSessionUpdated).toHaveBeenCalledWith(updatedSession);
    expect(result.current.savingKey).toBeNull();
  });

  it('routes through scorerApi when viaLink is true and keeps optimistic status if offline', async () => {
    scorerPutMock.mockRejectedValueOnce(new Error('offline'));

    const { result } = renderHook(() => useGateCheck({ viaLink: true }));
    const session = { id: 5, notes: '[gate:10:101=at-gate]' };
    const heat = {
      id: 10,
      entries: [
        { id: 1, teamId: 101, teamName: 'Alpha', laneIndex: 1 },
        { id: 2, teamId: 102, teamName: 'Bravo', laneIndex: 2 },
      ],
    };

    expect(result.current.isReadyAtGate(session, heat)).toBe(false);

    let returned: Session | null = null;
    await act(async () => {
      returned = await result.current.setStatus(session, 10, 102, 'at-gate');
    });

    expect(scorerPutMock).toHaveBeenCalledWith(
      '/scorer/heats/10/gate-check',
      { teamId: 102, status: 'at-gate' },
    );
    expect(returned).toBeNull();
    // Optimistic state remains so the steward still sees all lanes ready at the gate
    expect(result.current.getStatus(session, 10, 102)).toBe('at-gate');
    expect(result.current.isReadyAtGate(session, heat)).toBe(true);
  });
});
