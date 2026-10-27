import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import {
  ARENA_ASSISTANCE_SERVICES,
  arenaAssistanceLabel,
  formatArenaAssistanceMessage,
  requestArenaAssistance,
} from './arenaAssistance';

vi.mock('../api', () => ({ api: { post: vi.fn() } }));
const postMock = vi.mocked(api.post);

describe('arenaAssistance helpers', () => {
  beforeEach(() => {
    postMock.mockReset();
  });

  it('lists the three showground assistance services and formats their labels', () => {
    expect(ARENA_ASSISTANCE_SERVICES.map((s) => s.id)).toEqual(['farrier', 'vet', 'first-aid']);
    expect(arenaAssistanceLabel('farrier')).toBe('Farrier');
    expect(arenaAssistanceLabel('vet')).toBe('Vet');
    expect(arenaAssistanceLabel('first-aid')).toBe('First Aid');
  });

  it('formats the announcement text with default arena fallback and optional note', () => {
    expect(formatArenaAssistanceMessage('farrier', 'Arena 1')).toBe('Farrier needed at Arena 1');
    expect(formatArenaAssistanceMessage('vet', '   ')).toBe('Vet needed at Main Arena');
    expect(formatArenaAssistanceMessage('first-aid', 'Arena 2', '  Lane 3 rider  ')).toBe(
      'First Aid needed at Arena 2 — Lane 3 rider',
    );
  });

  it('posts an arena assistance call to the session assistance endpoint', async () => {
    const fakeMsg = { id: 42, competitionId: 1, authorName: 'Steward', body: 'Farrier needed at Arena 1', createdAt: '2026-06-01T10:00:00Z' };
    postMock.mockResolvedValueOnce({ data: fakeMsg });

    const res = await requestArenaAssistance(1, 9, {
      service: 'farrier',
      arenaName: 'Arena 1',
      note: 'Loose front shoe',
      holdArena: true,
    });

    expect(postMock).toHaveBeenCalledWith('/competitions/1/sessions/9/assistance', {
      service: 'farrier',
      arenaName: 'Arena 1',
      note: 'Loose front shoe',
      holdArena: true,
    });
    expect(res).toEqual(fakeMsg);
  });
});
