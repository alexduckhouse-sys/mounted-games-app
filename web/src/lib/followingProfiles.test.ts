import { describe, expect, it } from 'vitest';
import { clubTeamCount, lastOut, nextEntry } from './followingProfiles';

const NOW = new Date(2031, 4, 4, 12, 0, 0);
const link = (competitionId: number, teamId = competitionId * 10) => ({ competitionId, competitionName: `Event ${competitionId}`, teamId });

describe('nextEntry', () => {
  const competitions = [
    { id: 1, startDate: '2031-05-20T09:00:00Z' },
    { id: 2, startDate: '2031-05-10T09:00:00Z', endDate: '2031-05-11T17:00:00Z' },
    { id: 3, startDate: '2031-04-01T09:00:00Z' },
    { id: 4, startDate: '2031-06-01T09:00:00Z', isArchived: true },
    { id: 5, startDate: '2031-05-03T09:00:00Z', endDate: '2031-05-05T17:00:00Z' },
    { id: 6, startDate: 'not a date' },
  ];
  it('picks the soonest competition that has not finished', () => {
    expect(nextEntry([link(1), link(2), link(3)], competitions, NOW)).toMatchObject({ competitionId: 2, startDate: '2031-05-10T09:00:00Z', endDate: '2031-05-11T17:00:00Z', teamId: 20 });
  });
  it('counts a multi-day event that is on today', () => {
    expect(nextEntry([link(1), link(5)], competitions, NOW)?.competitionId).toBe(5);
  });
  it('ignores past, archived, unknown and undated competitions, and gives nothing when none is left', () => {
    expect(nextEntry([link(3), link(4), link(6), link(99)], competitions, NOW)).toBeNull();
    expect(nextEntry([], competitions, NOW)).toBeNull();
    expect(nextEntry([link(1)], [], NOW)).toBeNull();
  });
  it('gives a null end date when the competition has none', () => {
    expect(nextEntry([link(1)], competitions, NOW)).toMatchObject({ competitionId: 1, endDate: null });
  });
});

describe('lastOut', () => {
  it('is the latest published result', () => {
    expect(lastOut([
      { competitionName: 'Old Cup', competitionDate: '2031-03-01', eventRank: 2 },
      { competitionName: 'Welsh Open', competitionDate: '2031-04-05', eventRank: 5 },
      { competitionName: 'Mid Cup', competitionDate: '2031-03-20', eventRank: 1 },
    ])).toEqual({ place: 5, competitionName: 'Welsh Open', date: '2031-04-05' });
  });
  it('takes the newest version of a round once', () => {
    expect(lastOut([
      { competitionName: 'Welsh Open', competitionDate: '2031-04-05', eventRank: 5, publicationVersion: 1 },
      { competitionName: 'Welsh Open', competitionDate: '2031-04-05', eventRank: 4, publicationVersion: 2 },
      { competitionName: 'Welsh Open', competitionDate: '2031-04-05', eventRank: 6 },
    ])?.place).toBe(4);
  });
  it('is null with no usable results', () => {
    expect(lastOut([])).toBeNull();
    expect(lastOut([{ competitionName: 'Odd', competitionDate: 'nope', eventRank: 1 }])).toBeNull();
  });
});

describe('clubTeamCount', () => {
  const all = [
    { id: 'a', clubId: 1, clubName: 'Leicester Forest', displayName: 'Leicester Forest' },
    { id: 'b', clubId: 1, clubName: 'Leicester Forest', displayName: 'Leicester Forest U12' },
    { id: 'c', clubId: 1, clubName: 'Leicester Forest', displayName: 'Leicester Forest U14' },
    { id: 'd', clubId: 2, clubName: 'Dorset', displayName: 'Dorset' },
    { id: 'e', clubId: 3, clubName: 'Berwyn & Dee', displayName: 'Berwyn & Dee U14' },
  ];
  it('counts the teams of a club-wide profile', () => {
    expect(clubTeamCount('a', all)).toBe(3);
  });
  it('says nothing for a lone club profile, a named team, or an unknown profile', () => {
    expect(clubTeamCount('d', all)).toBeNull();
    expect(clubTeamCount('e', all)).toBeNull();
    expect(clubTeamCount('zzz', all)).toBeNull();
  });
});
