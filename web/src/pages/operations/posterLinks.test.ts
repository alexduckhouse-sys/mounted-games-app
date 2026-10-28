import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import type { ScorerLink } from '../../types';
import { activeScorerLinks, mintPosterLinks } from './posterLinks';

vi.mock('../../api', () => ({ api: { post: vi.fn() } }));

const link = (id: number, over: Partial<ScorerLink> = {}): ScorerLink => ({ id, label: `Ring ${id}`, arenaName: 'Main', createdAt: '2031-01-01T00:00:00Z', expiresAt: '2031-06-01T00:00:00Z', lastUsedAt: null, revokedAt: null, ...over });
const now = new Date('2031-05-01T00:00:00Z').getTime();

describe('poster scorer links', () => {
  beforeEach(() => vi.mocked(api.post).mockReset());

  it('keeps links that are neither withdrawn nor expired', () => {
    const list = [link(1), link(2, { revokedAt: '2031-04-01T00:00:00Z' }), link(3, { expiresAt: '2031-04-01T00:00:00Z' })];
    expect(activeScorerLinks(list, now).map((l) => l.id)).toEqual([1]);
  });

  it('mints a fresh link per active one and encodes the real /score#t= address', async () => {
    vi.mocked(api.post).mockImplementation(async (_url, body) => ({ data: { link: link(50, body as Partial<ScorerLink>), token: 'mgs_abc', path: '' } }));
    const result = await mintPosterLinks(12, [link(1, { scope: 2 }), link(2, { revokedAt: '2031-04-01T00:00:00Z' })], 'https://mg.test', now);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/competitions/12/scorer-links', { label: 'Ring 1', arenaName: 'Main', expiresAt: '2031-06-01T00:00:00Z', scope: 2 });
    expect(result.map((r) => r.url)).toEqual(['https://mg.test/score#t=mgs_abc']);
  });
});
