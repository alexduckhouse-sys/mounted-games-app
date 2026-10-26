import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { ChatMessage } from '../types';
import { useArenaAssistance } from './useArenaAssistance';

vi.mock('../api', () => ({ api: { post: vi.fn() } }));
const postMock = vi.mocked(api.post);

describe('useArenaAssistance', () => {
  beforeEach(() => {
    postMock.mockReset();
  });

  it('sends an assistance request with defaults and notifies onAnnouncementSent', async () => {
    const msg: ChatMessage = {
      id: 77,
      competitionId: 3,
      authorName: 'Chief Steward',
      body: 'Farrier needed at Arena 1',
      createdAt: '2026-06-01T10:00:00Z',
    };
    postMock.mockResolvedValueOnce({ data: msg });
    const onAnnouncementSent = vi.fn();

    const { result } = renderHook(() =>
      useArenaAssistance({
        competitionId: 3,
        sessionId: 12,
        defaultArenaName: 'Arena 1',
        onAnnouncementSent,
      }),
    );

    let returned: ChatMessage | null = null;
    await act(async () => {
      returned = await result.current.callAssistance('farrier');
    });

    expect(postMock).toHaveBeenCalledWith('/competitions/3/sessions/12/assistance', {
      service: 'farrier',
      arenaName: 'Arena 1',
      note: null,
      holdArena: true,
    });
    expect(returned).toEqual(msg);
    expect(result.current.lastSent).toEqual(msg);
    expect(result.current.error).toBeNull();
    expect(result.current.sendingService).toBeNull();
    expect(onAnnouncementSent).toHaveBeenCalledWith(msg);
  });

  it('records a friendly error message when the call fails and allows overrides', async () => {
    postMock.mockRejectedValueOnce(new Error('network down'));

    const { result } = renderHook(() =>
      useArenaAssistance({ competitionId: 3, sessionId: 12 }),
    );

    let returned: ChatMessage | null = null;
    await act(async () => {
      returned = await result.current.callAssistance('vet', {
        arenaName: 'Collecting Ring',
        note: 'Lane 2 pony',
        holdArena: false,
      });
    });

    expect(postMock).toHaveBeenCalledWith('/competitions/3/sessions/12/assistance', {
      service: 'vet',
      arenaName: 'Collecting Ring',
      note: 'Lane 2 pony',
      holdArena: false,
    });
    expect(returned).toBeNull();
    expect(result.current.error).toBe(
      'Could not send the arena call. Check your signal and try again.',
    );
  });
});
