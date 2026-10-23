import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CurrentCompetitionProvider, useCurrentCompetition } from './CurrentCompetitionContext';

const wrapper = ({ children }: { children: ReactNode }) => <CurrentCompetitionProvider>{children}</CurrentCompetitionProvider>;
const mount = () => renderHook(() => useCurrentCompetition(), { wrapper });
const cookieFor = (value: unknown) => `mg.competition=${encodeURIComponent(JSON.stringify(value))}; Path=/`;
const spring = { id: 4, name: 'Spring Games' };
const autumn = { id: 9, name: 'Autumn Games' };

describe('CurrentCompetitionProvider: starting point', () => {
  it('has no competition and asks what to remember when nothing is saved', () => {
    const { result } = mount();
    expect(result.current).toMatchObject({ current: null, venue: null, rememberChoice: 'ask', storageError: null });
  });

  it('uses the remembered competition from the cookie', () => {
    document.cookie = cookieFor(spring);
    const { result } = mount();
    expect(result.current.current).toEqual(spring);
    expect(result.current.rememberChoice).toBe('remember');
  });

  it('uses the competition chosen for this visit only', () => {
    sessionStorage.setItem('mg.competitionVisit', JSON.stringify(spring));
    const { result } = mount();
    expect(result.current.current).toEqual(spring);
    expect(result.current.rememberChoice).toBe('visit');
  });

  it('prefers the cookie over this visit’s choice', () => {
    document.cookie = cookieFor(spring);
    sessionStorage.setItem('mg.competitionVisit', JSON.stringify(autumn));
    expect(mount().result.current.current).toEqual(spring);
  });

  it('ignores an unusable visit choice', () => {
    sessionStorage.setItem('mg.competitionVisit', JSON.stringify({ id: 'x' }));
    expect(mount().result.current).toMatchObject({ current: null, rememberChoice: 'ask' });
  });

  it('asks again when storage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(mount().result.current).toMatchObject({ current: null, rememberChoice: 'ask' });
  });

  it('removes the old preference, which was saved without asking', () => {
    localStorage.setItem('mg.currentCompetition', JSON.stringify(spring));
    mount();
    expect(localStorage.getItem('mg.currentCompetition')).toBeNull();
  });

  it('carries on when the old preference cannot be removed', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => mount()).not.toThrow();
  });
});

describe('CurrentCompetitionProvider: choosing', () => {
  it('sets and clears the current competition', () => {
    const { result } = mount();
    act(() => result.current.setCurrent(spring));
    expect(result.current.current).toEqual(spring);
    act(() => result.current.clear());
    expect(result.current.current).toBeNull();
  });

  it('does not change anything when set to the same competition again', () => {
    const { result } = mount();
    act(() => result.current.setCurrent(spring));
    const before = result.current.current;
    act(() => result.current.setCurrent({ ...spring }));
    expect(result.current.current).toBe(before);
  });

  it('switches when the id or the name differs', () => {
    const { result } = mount();
    act(() => result.current.setCurrent(spring));
    act(() => result.current.setCurrent({ id: 4, name: 'Spring Games 2' }));
    expect(result.current.current?.name).toBe('Spring Games 2');
    act(() => result.current.setCurrent(autumn));
    expect(result.current.current).toEqual(autumn);
  });

  it('accepts null as no competition', () => {
    const { result } = mount();
    act(() => result.current.setCurrent(null));
    expect(result.current.current).toBeNull();
  });

  it('only reports the venue that belongs to the current competition', () => {
    const { result } = mount();
    act(() => { result.current.setCurrent(spring); result.current.setVenue({ competitionId: 4, lat: 51.5, lon: -1.2 }); });
    expect(result.current.venue).toEqual({ competitionId: 4, lat: 51.5, lon: -1.2 });
    act(() => result.current.setCurrent(autumn));
    expect(result.current.venue).toBeNull();
  });

  it('reports no venue when there is no current competition', () => {
    const { result } = mount();
    act(() => result.current.setVenue({ competitionId: 4, lat: 1, lon: 2 }));
    expect(result.current.venue).toBeNull();
  });
});

describe('CurrentCompetitionProvider: remembering', () => {
  it('saves a cookie when told to remember', () => {
    const { result } = mount();
    act(() => { result.current.setCurrent(spring); result.current.setRememberChoice('remember'); });
    expect(document.cookie).toContain(`mg.competition=${encodeURIComponent(JSON.stringify(spring))}`);
    expect(result.current.storageError).toBeNull();
    expect(sessionStorage.getItem('mg.competitionVisit')).toBeNull();
  });

  it('keeps the competition for this visit only, with no cookie', () => {
    const { result } = mount();
    act(() => { result.current.setCurrent(spring); result.current.setRememberChoice('visit'); });
    expect(document.cookie).not.toContain('mg.competition');
    expect(JSON.parse(sessionStorage.getItem('mg.competitionVisit')!)).toEqual(spring);
  });

  it('keeps nothing while it has not asked yet', () => {
    const { result } = mount();
    act(() => result.current.setCurrent(spring));
    expect(document.cookie).not.toContain('mg.competition');
    expect(sessionStorage.getItem('mg.competitionVisit')).toBeNull();
  });

  it('expires the cookie when the choice changes to this visit only', () => {
    document.cookie = cookieFor(spring);
    const { result } = mount();
    act(() => result.current.setRememberChoice('visit'));
    expect(document.cookie).not.toContain('mg.competition');
  });

  it('follows a change of competition in the cookie', () => {
    document.cookie = cookieFor(spring);
    const { result } = mount();
    act(() => result.current.setCurrent(autumn));
    expect(document.cookie).toContain(encodeURIComponent(JSON.stringify(autumn)));
  });

  it('says so when the browser will not keep the cookie, but still uses the competition', () => {
    vi.spyOn(Document.prototype, 'cookie', 'set').mockImplementation(() => {});
    const { result } = mount();
    act(() => { result.current.setCurrent(spring); result.current.setRememberChoice('remember'); });
    expect(result.current.storageError).toBe('Your browser could not save this competition. You can still use it for this visit.');
    expect(result.current.current).toEqual(spring);
  });

  it('says so when saving the choice throws', () => {
    vi.spyOn(Document.prototype, 'cookie', 'set').mockImplementation(() => { throw new Error('blocked'); });
    const { result } = mount();
    expect(result.current.storageError).toBe('Your browser could not save this choice. You can still use the competition.');
  });
});

describe('CurrentCompetitionProvider: forgetting', () => {
  it('drops a remembered competition, its cookie and the choice', () => {
    document.cookie = cookieFor(spring);
    const { result } = mount();
    act(() => result.current.forget());
    expect(result.current).toMatchObject({ current: null, rememberChoice: 'ask' });
    expect(document.cookie).not.toContain('mg.competition');
  });

  it('drops a competition kept for this visit', () => {
    sessionStorage.setItem('mg.competitionVisit', JSON.stringify(spring));
    const { result } = mount();
    act(() => result.current.forget());
    expect(result.current).toMatchObject({ current: null, rememberChoice: 'ask' });
    expect(sessionStorage.getItem('mg.competitionVisit')).toBeNull();
  });

  it('lets the next competition be chosen afresh', () => {
    document.cookie = cookieFor(spring);
    const { result } = mount();
    act(() => result.current.forget());
    act(() => result.current.setCurrent(autumn));
    expect(result.current).toMatchObject({ current: autumn, rememberChoice: 'ask' });
    expect(document.cookie).not.toContain('mg.competition');
  });

  it('still forgets when the browser will not let it touch storage', () => {
    const { result } = mount();
    act(() => result.current.setCurrent(spring));
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    act(() => result.current.forget());
    expect(result.current.current).toBeNull();
  });
});

describe('useCurrentCompetition', () => {
  it('must be used inside the provider', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useCurrentCompetition())).toThrow('useCurrentCompetition must be used inside CurrentCompetitionProvider');
    error.mockRestore();
  });
});
