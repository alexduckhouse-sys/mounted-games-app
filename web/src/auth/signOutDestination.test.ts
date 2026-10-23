import { afterEach, describe, expect, it, vi } from 'vitest';
import { signOutDestination } from './signOutDestination';

afterEach(() => { document.cookie = 'mg.competition=; Max-Age=0; Path=/'; vi.restoreAllMocks(); });

describe('signOutDestination', () => {
  it('goes to the events page when no competition is current', () => {
    expect(signOutDestination()).toBe('/');
  });

  it('goes to the timetable of a remembered competition', () => {
    document.cookie = `mg.competition=${encodeURIComponent(JSON.stringify({ id: 7, name: 'Zone' }))}; Path=/`;
    expect(signOutDestination()).toBe('/competitions/7');
  });

  it('goes to the timetable of the competition being visited', () => {
    sessionStorage.setItem('mg.competitionVisit', JSON.stringify({ id: 3, name: 'Champs' }));
    expect(signOutDestination()).toBe('/competitions/3');
  });

  it('ignores a damaged visit entry', () => {
    sessionStorage.setItem('mg.competitionVisit', 'nonsense');
    expect(signOutDestination()).toBe('/');
  });

  it('falls back to the events page when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(signOutDestination()).toBe('/');
  });
});
