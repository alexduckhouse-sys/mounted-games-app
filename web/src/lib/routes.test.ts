import { describe, expect, it } from 'vitest';
import { competitionIdFromPath, hasGlobalTabs } from './routes';

describe('competitionIdFromPath', () => {
  it.each([
    ['/competitions/12', 12],
    ['/competitions/12/', 12],
    ['/competitions/12/toplists', 12],
    ['/competitions/7/session/3', 7],
  ])('reads the id from %s', (path, id) => {
    expect(competitionIdFromPath(path)).toBe(id);
  });

  it.each(['/', '/competitions', '/competitions/past', '/competitions/12abc', '/admin/competitions/12', '/competitions/'])(
    'returns null for %s',
    (path) => {
      expect(competitionIdFromPath(path)).toBeNull();
    },
  );
});

describe('hasGlobalTabs', () => {
  it.each(['/', '/competitions', '/competitions/past', '/following', '/chat', '/dashboard', '/teams', '/me/signups', '/shop', '/shop/'])('is true for %s', (path) => {
    expect(hasGlobalTabs(path)).toBe(true);
  });

  it.each(['/competitions/4', '/me', '/admin', '/login', '/declarations', '/me/account'])('is false for %s', (path) => {
    expect(hasGlobalTabs(path)).toBe(false);
  });
});
