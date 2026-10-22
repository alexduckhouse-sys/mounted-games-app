import { describe, expect, it, vi } from 'vitest';
import { FAVOURITES_CHANGED, FAVOURITES_KEY, readFavourites, setFavourites, toggleFavourite } from './favourites';

describe('public favourites', () => {
  it('works without an account and stores only IDs', () => {
    const listener = vi.fn();
    window.addEventListener(FAVOURITES_CHANGED, listener);
    expect(readFavourites()).toEqual([]);
    expect(toggleFavourite({ competitionId: 1, teamId: 2 })).toBeNull();
    expect(readFavourites()).toEqual([{ competitionId: 1, teamId: 2 }]);
    expect(toggleFavourite({ competitionId: 2, teamId: 2 })).toBeNull();
    expect(toggleFavourite({ competitionId: 1, teamId: 2 })).toBeNull();
    expect(readFavourites()).toEqual([{ competitionId: 2, teamId: 2 }]);
    expect(toggleFavourite({ competitionId: 2, teamId: 2 })).toBeNull();
    expect(localStorage.getItem(FAVOURITES_KEY)).toBeNull();
    expect(listener).toHaveBeenCalledTimes(4);
    window.removeEventListener(FAVOURITES_CHANGED, listener);
  });

  it('ignores malformed, duplicate or private fields in stored data', () => {
    for (const text of ['broken', '{}', 'null']) {
      localStorage.setItem(FAVOURITES_KEY, text);
      expect(readFavourites()).toEqual([]);
    }
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify([null, 'x', {}, { competitionId: -1, teamId: 2 },
      { competitionId: 1, teamId: '2' }, { competitionId: 1.5, teamId: 2 }, { competitionId: 1, teamId: 0 },
      { competitionId: 1, teamId: 2, contact: 'never retained' }, { competitionId: 1, teamId: 2 }]));
    expect(readFavourites()).toEqual([{ competitionId: 1, teamId: 2 }]);
    expect(toggleFavourite({ competitionId: 0, teamId: 1 })).toMatch(/couldn’t be followed/);
  });

  it('bounds storage but always allows removing a team', () => {
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify(Array.from({ length: 105 }, (_, i) => ({ competitionId: 1, teamId: i + 1 }))));
    expect(readFavourites()).toHaveLength(100);
    expect(toggleFavourite({ competitionId: 1, teamId: 200 })).toMatch(/100 teams/);
    expect(toggleFavourite({ competitionId: 1, teamId: 1 })).toBeNull();
    expect(readFavourites()).toHaveLength(99);
  });

  it('reports blocked storage without pretending to save', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readFavourites()).toEqual([]);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    expect(toggleFavourite({ competitionId: 1, teamId: 1 })).toMatch(/couldn’t be saved/);
  });

  it('follows and unfollows a group of teams in one go', () => {
    const listener = vi.fn();
    window.addEventListener(FAVOURITES_CHANGED, listener);
    const club = [1, 2, 3].map((teamId) => ({ competitionId: 1, teamId }));
    expect(toggleFavourite({ competitionId: 1, teamId: 2 })).toBeNull();
    expect(setFavourites([...club, club[0]], true)).toBeNull();
    expect(readFavourites()).toEqual([{ competitionId: 1, teamId: 2 }, { competitionId: 1, teamId: 1 }, { competitionId: 1, teamId: 3 }]);
    expect(setFavourites(club, true)).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(toggleFavourite({ competitionId: 2, teamId: 2 })).toBeNull();
    expect(setFavourites(club, false)).toBeNull();
    expect(readFavourites()).toEqual([{ competitionId: 2, teamId: 2 }]);
    expect(setFavourites(club, false)).toBeNull();
    expect(setFavourites([{ competitionId: 2, teamId: 2 }], false)).toBeNull();
    expect(localStorage.getItem(FAVOURITES_KEY)).toBeNull();
    window.removeEventListener(FAVOURITES_CHANGED, listener);
  });

  it('follows a group completely or not at all, and reports problems', () => {
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify(Array.from({ length: 98 }, (_, i) => ({ competitionId: 1, teamId: i + 1 }))));
    const three = [200, 201, 202].map((teamId) => ({ competitionId: 1, teamId }));
    expect(setFavourites(three, true)).toMatch(/over 100 teams/);
    expect(readFavourites()).toHaveLength(98);
    expect(setFavourites(three.slice(0, 2), true)).toBeNull();
    expect(readFavourites()).toHaveLength(100);
    expect(setFavourites([{ competitionId: 0, teamId: 1 }], true)).toMatch(/couldn’t be followed/);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    expect(setFavourites([{ competitionId: 1, teamId: 1 }], false)).toMatch(/couldn’t be saved/);
  });
});
