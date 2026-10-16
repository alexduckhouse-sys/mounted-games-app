import { describe, expect, it } from 'vitest';
import { competitionIdFromPath } from './routes';

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
