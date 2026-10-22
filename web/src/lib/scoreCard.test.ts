import { describe, expect, it } from 'vitest';
import type { Heat, Race } from '../types';
import { applyScoreCardControl, newlyScoredRace, parseScoreCardControl, queueScoreCard, scoreCardFor } from './scoreCard';
import { competition, session } from '../test/factories';

const teams = ['England', 'Ireland', 'Wales', 'Scotland'];
const entries = teams.map((teamName, i) => ({ id: i + 1, teamId: i + 1, teamName, laneIndex: i }));

function race(id: number, orderIndex: number, points: number[] | null, eliminated: number[] = []): Race {
  return {
    id, heatId: 1, name: `Race ${id}`, orderIndex, isComplete: points !== null,
    results: (points ?? []).map((p, i) => ({ id: id * 10 + i, teamId: i + 1, teamName: teams[i], placing: null, eliminated: eliminated.includes(i + 1), points: p })),
  };
}

const heat = (races: Race[]): Heat => ({ id: 1, sessionId: 1, orderIndex: 1, entries, races });

describe('scoreCardFor', () => {
  it('gives the whole heat table after the first race, with what it added', () => {
    const card = scoreCardFor(heat([race(11, 1, [4, 3, 2, 1]), race(12, 2, null)]), 11)!;
    expect(card).toMatchObject({ raceId: 11, raceName: 'Race 11', raceNumber: 1, raceCount: 2 });
    expect(card.rows.map((r) => [r.teamName, r.place, r.total, r.added, r.change])).toEqual([
      ['England', 1, 4, 4, null], ['Ireland', 2, 3, 3, null], ['Wales', 3, 2, 2, null], ['Scotland', 4, 1, 1, null],
    ]);
  });

  it('shows who moved up and down, and keeps eliminations', () => {
    const card = scoreCardFor(heat([race(11, 1, [4, 3, 2, 1]), race(12, 2, [0, 1, 4, 3], [1])]), 12)!;
    expect(card.raceNumber).toBe(2);
    expect(card.rows.map((r) => [r.teamName, r.place, r.total, r.added, r.change, r.eliminated])).toEqual([
      ['Wales', 1, 6, 4, 'up', false],
      ['England', 2, 4, 0, 'down', true],
      ['Ireland', 2, 4, 1, null, false],
      ['Scotland', 2, 4, 3, 'up', false],
    ]);
  });

  it('shares places on equal totals and orders ties by name', () => {
    const card = scoreCardFor(heat([race(11, 1, [2, 2, 1, 1])]), 11)!;
    expect(card.rows.map((r) => [r.teamName, r.place])).toEqual([['England', 1], ['Ireland', 1], ['Scotland', 3], ['Wales', 3]]);
  });

  it('counts only completed races before this one, in race order', () => {
    const card = scoreCardFor(heat([race(13, 3, [1, 1, 1, 1]), race(12, 2, null), race(11, 1, [4, 3, 2, 1])]), 13)!;
    expect(card.raceNumber).toBe(3);
    expect(card.rows[0]).toMatchObject({ teamName: 'England', total: 5, added: 1, change: null });
  });

  it('gives teams with no result zero', () => {
    const partial = race(11, 1, [4]);
    expect(scoreCardFor(heat([partial]), 11)!.rows.find((r) => r.teamName === 'Wales')).toMatchObject({ total: 0, added: 0, eliminated: false });
  });

  it('has no card for an unknown or unscored race', () => {
    expect(scoreCardFor(heat([race(11, 1, null)]), 11)).toBeNull();
    expect(scoreCardFor(heat([race(11, 1, [4, 3, 2, 1])]), 99)).toBeNull();
  });
});

describe('newlyScoredRace', () => {
  it('finds the race whose results just arrived', () => {
    const before = heat([race(11, 1, [4, 3, 2, 1]), race(12, 2, null)]);
    const after = heat([race(11, 1, [4, 3, 2, 1]), race(12, 2, [1, 2, 3, 4])]);
    expect(newlyScoredRace(before, after)).toBe(12);
  });

  it('notices a correction to an earlier race', () => {
    const before = heat([race(11, 1, [4, 3, 2, 1]), race(12, 2, [1, 2, 3, 4])]);
    const after = heat([race(11, 1, [3, 4, 2, 1]), race(12, 2, [1, 2, 3, 4])]);
    expect(newlyScoredRace(before, after)).toBe(11);
  });

  it('ignores repeats, cleared races and a heat it has not seen scored', () => {
    const scored = heat([race(11, 1, [4, 3, 2, 1])]);
    expect(newlyScoredRace(scored, scored)).toBeNull();
    expect(newlyScoredRace(scored, heat([race(11, 1, null)]))).toBeNull();
    expect(newlyScoredRace(undefined, heat([race(11, 1, [])]))).toBeNull();
    expect(newlyScoredRace(undefined, scored)).toBe(11);
  });
});

describe('queueScoreCard', () => {
  const comp = (heats: Heat[], arenaName: string | null = ' Arena 1 ') => competition({
    sessions: [session(1, { arenaName, heats, sectionName: 'Seniors', name: 'Seniors' })],
  });

  it('queues the card for the race an update just scored, with its arena and heading', () => {
    const before = heat([race(11, 1, [4, 3, 2, 1]), race(12, 2, null)]);
    const after = heat([race(11, 1, [4, 3, 2, 1]), race(12, 2, [1, 2, 3, 4])]);
    const queued = queueScoreCard(comp([before]), 1, after, 5000)!;
    expect(queued).toMatchObject({ key: '1-12-5000', arenaName: 'Arena 1', receivedAt: 5000 });
    expect(queued.heading).toMatch(/^Seniors Session 1 · Heat 1$/);
    expect(queued.card.raceId).toBe(12);
  });

  it('uses the heat label, and numbers a heat it has not seen after the others', () => {
    const scored = heat([race(11, 1, [4, 3, 2, 1])]);
    expect(queueScoreCard(comp([]), 1, { ...scored, label: 'Final' }, 1)!.heading).toMatch(/· Final$/);
    expect(queueScoreCard(comp([heat([]), { ...heat([]), id: 2 }]), 1, { ...scored, id: 3 }, 1)!.heading).toMatch(/· Heat 3$/);
    expect(queueScoreCard(comp([], null), 1, scored, 1)!.arenaName).toBe('');
  });

  it('queues nothing without the session or without a newly scored race', () => {
    const scored = heat([race(11, 1, [4, 3, 2, 1])]);
    expect(queueScoreCard(null, 1, scored, 1)).toBeNull();
    expect(queueScoreCard(comp([scored]), 9, scored, 1)).toBeNull();
    expect(queueScoreCard(comp([scored]), 1, scored, 1)).toBeNull();
  });
});

describe('producer instructions', () => {
  const queued = (heatId: number, raceId: number, receivedAt = 1000) => ({ ...queueScoreCard(
    competition({ sessions: [session(1, { heats: [] })] }), 1, { ...heat([race(raceId, 1, [4, 3, 2, 1])]), id: heatId }, receivedAt)! });

  it('parses a relayed instruction and ignores nonsense', () => {
    expect(parseScoreCardControl({ heatId: 1, raceId: 2, action: 'edit', hiddenTeamIds: [3, 'x'], names: { 4: 'Pony Club A', x: 'bad', 5: 7 }, seconds: 12 }))
      .toEqual({ heatId: 1, raceId: 2, action: 'edit', hiddenTeamIds: [3], names: { 4: 'Pony Club A' }, seconds: 12 });
    expect(parseScoreCardControl({ heatId: 1, raceId: 2, action: 'skip' })).toEqual({ heatId: 1, raceId: 2, action: 'skip', hiddenTeamIds: [], names: {}, seconds: null });
    expect(parseScoreCardControl(null)).toBeNull();
    expect(parseScoreCardControl({ heatId: 1, raceId: 2, action: 'delete' })).toBeNull();
    expect(parseScoreCardControl({ heatId: '1', raceId: 2, action: 'show' })).toBeNull();
  });

  it('skips, shows now and edits only the matching card', () => {
    const cards = [queued(1, 11), queued(2, 21)];
    const control = { heatId: 1, raceId: 11, hiddenTeamIds: [2], names: { 1: 'E' }, seconds: 15 };
    expect(applyScoreCardControl(cards, { ...control, action: 'skip' }, 5000, 4000).map((c) => c.card.heatId)).toEqual([2]);

    const shown = applyScoreCardControl(cards, { ...control, action: 'show' }, 5000, 4000);
    expect(shown[0].receivedAt).toBe(1000);
    expect(shown[1]).toBe(cards[1]);

    const edited = applyScoreCardControl(cards, { ...control, action: 'edit' }, 5000, 4000);
    expect(edited[0]).toMatchObject({ hiddenTeamIds: [2], names: { 1: 'E' }, seconds: 15, receivedAt: 1000 });
  });
});
