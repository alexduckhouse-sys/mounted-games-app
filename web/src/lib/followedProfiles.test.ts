import { describe, expect, it, vi } from 'vitest';
import { FAVOURITES_CHANGED } from './favourites';
import { FOLLOWED_PROFILES_KEY, MAX_FOLLOWED_PROFILES, readFollowedProfiles, setFollowedProfile, toggleFollowedProfile } from './followedProfiles';

const north = { id: 'north-a', name: 'North Club A', clubName: 'North Club' };
const south = { id: 'south-b', name: 'South Club B', clubName: 'South Club' };

describe('followed profiles', () => {
  it('starts empty, and ignores storage that is damaged or not a list', () => {
    expect(readFollowedProfiles()).toEqual([]);
    localStorage.setItem(FOLLOWED_PROFILES_KEY, 'not json');
    expect(readFollowedProfiles()).toEqual([]);
    localStorage.setItem(FOLLOWED_PROFILES_KEY, '{"id":"x"}');
    expect(readFollowedProfiles()).toEqual([]);
  });

  it('keeps only well-formed, unique entries and trims long names', () => {
    const long = 'x'.repeat(300);
    localStorage.setItem(FOLLOWED_PROFILES_KEY, JSON.stringify([north, north, null, 4, { id: '', name: 'a', clubName: 'b' }, { id: 'y'.repeat(65), name: 'a', clubName: 'b' }, { id: 'z', name: 1, clubName: 'b' }, { id: 'w', name: long, clubName: long }]));
    const read = readFollowedProfiles();
    expect(read.map((item) => item.id)).toEqual(['north-a', 'w']);
    expect(read[1].name).toHaveLength(200);
    expect(read[1].clubName).toHaveLength(200);
  });

  it('follows and unfollows, announces each change, and does nothing when already as asked', () => {
    const changed = vi.fn();
    window.addEventListener(FAVOURITES_CHANGED, changed);
    expect(setFollowedProfile(north, true)).toBeNull();
    expect(setFollowedProfile(south, true)).toBeNull();
    expect(readFollowedProfiles()).toEqual([north, south]);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(setFollowedProfile(north, true)).toBeNull();
    expect(setFollowedProfile({ id: 'nobody', name: 'n', clubName: 'c' }, false)).toBeNull();
    expect(changed).toHaveBeenCalledTimes(2);
    expect(setFollowedProfile(north, false)).toBeNull();
    expect(readFollowedProfiles()).toEqual([south]);
    expect(setFollowedProfile(south, false)).toBeNull();
    expect(localStorage.getItem(FOLLOWED_PROFILES_KEY)).toBeNull();
    window.removeEventListener(FAVOURITES_CHANGED, changed);
  });

  it('toggles', () => {
    expect(toggleFollowedProfile(north)).toBeNull();
    expect(readFollowedProfiles()).toEqual([north]);
    expect(toggleFollowedProfile(north)).toBeNull();
    expect(readFollowedProfiles()).toEqual([]);
  });

  it('refuses a malformed profile and stops at the limit', () => {
    expect(setFollowedProfile({ id: '', name: 'a', clubName: 'b' }, true)).toMatch(/couldn’t be followed/);
    const many = Array.from({ length: MAX_FOLLOWED_PROFILES }, (_, index) => ({ id: `p${index}`, name: `Team ${index}`, clubName: 'Club' }));
    localStorage.setItem(FOLLOWED_PROFILES_KEY, JSON.stringify(many));
    expect(setFollowedProfile(north, true)).toMatch(/following 100 teams/);
    expect(readFollowedProfiles()).toHaveLength(MAX_FOLLOWED_PROFILES);
    expect(setFollowedProfile(many[0], false)).toBeNull();
    expect(setFollowedProfile(north, true)).toBeNull();
  });

  it('says so when the device cannot save, and does not announce a change', () => {
    const changed = vi.fn();
    window.addEventListener(FAVOURITES_CHANGED, changed);
    const block = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    expect(setFollowedProfile(north, true)).toMatch(/couldn’t be saved/);
    expect(changed).not.toHaveBeenCalled();
    block.mockRestore();
    window.removeEventListener(FAVOURITES_CHANGED, changed);
  });
});
