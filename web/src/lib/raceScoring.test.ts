import { describe, expect, it, vi } from 'vitest';
import type { Heat } from '../types';
import { heat, race, result } from '../test/factories';
import {
  nextRaceToScore, placesFromResults, readScoringDraft, scoringDraftKey, setNote, setStatus, tapTeam, toggleEliminated, writeScoringDraft, type PendingPlace,
} from './raceScoring';

const places = (list: PendingPlace[]) => list.map((p) => (p.eliminated ? `${p.teamId}:out` : `${p.teamId}:${p.place}`));
const tapAll = (...ids: number[]) => ids.reduce<PendingPlace[]>((list, id) => tapTeam(list, id), []);

describe('tapTeam', () => {
  it('gives each tapped team the next place', () => {
    expect(places(tapAll(3, 1, 2))).toEqual(['3:1', '1:2', '2:3']);
  });

  it('closes the gap when a placed team is tapped again', () => {
    expect(places(tapTeam(tapAll(3, 1, 2), 3))).toEqual(['1:1', '2:2']);
  });

  it('places the next team after the finishers only, not after eliminated teams', () => {
    const list = tapTeam(toggleEliminated(tapAll(1, 2), 1), 3);
    expect(places(list)).toEqual(['1:out', '2:1', '3:2']);
  });

  it('places a team tapped after an elimination without a gap or a repeat', () => {
    const list = toggleEliminated(toggleEliminated([], 9), 8);
    expect(places(tapTeam(tapTeam(list, 1), 2))).toEqual(['9:out', '8:out', '1:1', '2:2']);
  });

  it('renumbers when an eliminated team is tapped off the list', () => {
    const list = toggleEliminated(tapAll(1, 2, 3), 2);
    expect(places(tapTeam(list, 2))).toEqual(['1:1', '3:2']);
  });
});

describe('tapTeam in a qualifier', () => {
  it('places teams up to the cap, then eliminates any further team tapped', () => {
    const list = [3, 1, 2, 4].reduce<PendingPlace[]>((cur, id) => tapTeam(cur, id, 2), []);
    expect(places(list)).toEqual(['3:1', '1:2', '2:out', '4:out']);
  });

  it('places again once a qualifier is tapped off', () => {
    const full = [3, 1].reduce<PendingPlace[]>((cur, id) => tapTeam(cur, id, 2), []);
    expect(places(tapTeam(tapTeam(full, 3, 2), 5, 2))).toEqual(['1:1', '5:2']);
  });
});

describe('toggleEliminated', () => {
  it('eliminates a placed team and closes the gap behind it', () => {
    expect(places(toggleEliminated(tapAll(1, 2, 3), 1))).toEqual(['1:out', '2:1', '3:2']);
    expect(places(toggleEliminated(tapAll(1, 2, 3), 2))).toEqual(['1:1', '2:out', '3:2']);
  });

  it('eliminates a team that was never tapped, with no place', () => {
    expect(toggleEliminated(tapAll(1), 2)).toEqual([
      { teamId: 1, place: 1, eliminated: false },
      { teamId: 2, place: 0, eliminated: true },
    ]);
  });

  it('puts a team that is brought back at the end of the order', () => {
    const out = toggleEliminated(tapAll(1, 2), 1);
    expect(places(toggleEliminated(out, 1))).toEqual(['2:1', '1:2']);
  });

  it('keeps places unique and gap-free through any mix of taps and eliminations', () => {
    let list: PendingPlace[] = [];
    const steps: Array<['tap' | 'elim', number]> = [
      ['tap', 4], ['tap', 2], ['elim', 4], ['tap', 5], ['elim', 7], ['elim', 4], ['tap', 2], ['tap', 6], ['elim', 5],
    ];
    for (const [step, id] of steps) {
      list = step === 'tap' ? tapTeam(list, id) : toggleEliminated(list, id);
      const placed = list.filter((p) => !p.eliminated).map((p) => p.place);
      expect(placed).toEqual(placed.map((_, i) => i + 1));
      expect(list.filter((p) => p.eliminated).every((p) => p.place === 0)).toBe(true);
    }
  });
});

describe('nextRaceToScore', () => {
  const entry = { id: 1, teamId: 1, teamName: 'Team 1', laneIndex: 1 };
  // Heat 1 holds races 11-13 and heat 2 holds races 21-23.
  const heats = (extra: (h: Heat, i: number) => Partial<Heat> = () => ({})): Heat[] => [1, 2].map((n, i) => {
    const h = heat(n, { entries: [entry], races: [1, 2, 3].map((r) => race(n * 10 + r, { orderIndex: r })) });
    return { ...h, ...extra(h, i) };
  });
  const none = new Set<number>();
  const next = (list: Heat[], alternating: boolean, heatId: number, raceId: number, queued: number[] = []) =>
    nextRaceToScore(list, alternating, { heatId, raceId }, new Set(queued))?.raceId ?? null;

  it('finishes a heat before starting the next when races are not alternating', () => {
    expect(next(heats(), false, 1, 11)).toBe(12);
    expect(next(heats(), false, 1, 12)).toBe(13);
    expect(next(heats(), false, 1, 13)).toBe(21);
    expect(next(heats(), false, 2, 21)).toBe(22);
  });

  it('goes across the heats for each race when races alternate', () => {
    expect(next(heats(), true, 1, 11)).toBe(21);
    expect(next(heats(), true, 2, 21)).toBe(12);
    expect(next(heats(), true, 1, 12)).toBe(22);
    expect(next(heats(), true, 2, 22)).toBe(13);
    expect(next(heats(), true, 1, 13)).toBe(23);
  });

  it('reports the heat the next race is in', () => {
    expect(nextRaceToScore(heats(), true, { heatId: 1, raceId: 11 }, none)).toEqual({ heatId: 2, raceId: 21 });
    expect(nextRaceToScore(heats(), false, { heatId: 1, raceId: 13 }, none)).toEqual({ heatId: 2, raceId: 21 });
  });

  it('skips races that are scored or waiting to send, and uses the race order rather than list order', () => {
    const list = heats((h) => ({ races: h.races.slice().reverse() }));
    list[0].races.find((r) => r.id === 12)!.isComplete = true;
    expect(next(list, false, 1, 11)).toBe(13);
    expect(next(list, false, 1, 11, [13])).toBe(21);
    expect(next(list, true, 1, 11, [21])).toBe(22);
  });

  it('wraps round to a race left unscored earlier, and stops when nothing is left', () => {
    expect(next(heats(), false, 2, 23)).toBe(11);
    const done = heats((h) => ({ races: h.races.map((r) => ({ ...r, isComplete: true })) }));
    expect(next(done, false, 2, 23)).toBeNull();
    expect(next(heats(), false, 1, 11, [12, 13, 21, 22, 23])).toBeNull();
  });

  it('copes with heats that have different numbers of races, and skips heats with no teams', () => {
    const list = heats((h) => (h.id === 2 ? { races: h.races.slice(0, 1) } : {}));
    expect(next(list, true, 2, 21)).toBe(12);
    expect(next(list, true, 1, 12)).toBe(13);
    const empty = heats((h) => (h.id === 2 ? { entries: [] } : {}));
    expect(next(empty, false, 1, 13)).toBe(11);
    expect(next(empty, true, 1, 11)).toBe(12);
  });

  it('copes with a current race that is not in the list', () => {
    expect(next(heats(), false, 9, 99)).toBe(11);
  });

  it('keeps to the current heat in a race-finals session', () => {
    const finals = heats((_, i) => ({ raceRoundStage: i === 0 ? 1 : 2 }));
    expect(next(finals, true, 1, 11)).toBe(12);
    expect(next(finals, false, 1, 13, [12])).toBe(11);
    expect(next(finals, false, 1, 13, [11, 12])).toBeNull();
    expect(next(finals, false, 7, 11)).toBeNull();
    expect(next(finals, false, 1, 11, [12])).toBe(13);
  });
});

describe('setStatus', () => {
  it('puts a team that was never tapped out with its reason', () => {
    expect(setStatus(tapAll(1), 2, 2)).toEqual([
      { teamId: 1, place: 1, eliminated: false },
      { teamId: 2, place: 0, eliminated: true, status: 2 },
    ]);
  });

  it('turns a placed team into a non-finisher and closes the gap behind it', () => {
    const list = setStatus(tapAll(1, 2, 3), 1, 3);
    expect(list.map((p) => `${p.teamId}:${p.eliminated ? 'out' : p.place}`)).toEqual(['1:out', '2:1', '3:2']);
    expect(list[0].status).toBe(3);
  });

  it('changes the reason of a team that is already out', () => {
    expect(setStatus(setStatus([], 4, 2), 4, 4)).toEqual([{ teamId: 4, place: 0, eliminated: true, status: 4 }]);
  });

  it('brings a team back as a finisher at the end of the order, dropping its reason but keeping its note', () => {
    const out = setNote(setStatus(tapAll(1), 2, 3), 2, 'Lame');
    expect(setStatus(out, 2, 0)).toEqual([
      { teamId: 1, place: 1, eliminated: false },
      { teamId: 2, place: 2, eliminated: false, refereeNote: 'Lame' },
    ]);
  });

  it('does nothing to bring back a team that finished or was never in the list', () => {
    const list = tapAll(1);
    expect(setStatus(list, 1, 0)).toBe(list);
    expect(setStatus(list, 9, 0)).toBe(list);
  });

  it('leaves a plain swipe elimination without a reason, which the server reads as eliminated', () => {
    expect(toggleEliminated([], 5)).toEqual([{ teamId: 5, place: 0, eliminated: true }]);
  });
});

describe('setNote', () => {
  it('attaches a note to a team in the list and leaves the others alone', () => {
    expect(setNote(tapAll(1, 2), 2, 'Dropped a baton')).toEqual([
      { teamId: 1, place: 1, eliminated: false },
      { teamId: 2, place: 2, eliminated: false, refereeNote: 'Dropped a baton' },
    ]);
  });

  it('has nothing to attach to for a team that is not in the list', () => {
    expect(setNote(tapAll(1), 7, 'x')).toEqual([{ teamId: 1, place: 1, eliminated: false }]);
  });
});

describe('placesFromResults', () => {
  it('lists saved results in finishing order, with eliminated teams last and without a place', () => {
    const r = race(1, {
      isComplete: true,
      results: [result(3, null, { eliminated: true }), result(2, 2), result(1, 1)],
    });
    expect(placesFromResults(r)).toEqual([
      { teamId: 1, place: 1, eliminated: false },
      { teamId: 2, place: 2, eliminated: false },
      { teamId: 3, place: 0, eliminated: true, status: 1 },
    ]);
  });

  it('carries the reason a team did not finish, and the notes staff have saved', () => {
    const r = race(1, { results: [result(1, 1), result(2, null, { eliminated: true, status: 3 }), result(3, null, { eliminated: true })] });
    expect(placesFromResults(r, { 1: 'Warned for rough riding' })).toEqual([
      { teamId: 1, place: 1, eliminated: false, refereeNote: 'Warned for rough riding' },
      { teamId: 2, place: 0, eliminated: true, status: 3 },
      { teamId: 3, place: 0, eliminated: true, status: 1 },
    ]);
  });

  it('leaves out teams that sat the race out', () => {
    const r = race(1, { results: [result(1, 1), result(2, null, { isSitOut: true }), result(3, 2)] });
    expect(placesFromResults(r).map((p) => p.teamId)).toEqual([1, 3]);
  });

  it('numbers a result that has no placing by its position', () => {
    expect(placesFromResults(race(1, { results: [result(5, null)] }))).toEqual([{ teamId: 5, place: 1, eliminated: false }]);
  });
});

describe('scoring drafts with reasons and notes', () => {
  const key = scoringDraftKey(8, 8);
  it('round-trips a status and a note and refuses a malformed one', () => {
    const draft: PendingPlace[] = [{ teamId: 1, place: 0, eliminated: true, status: 2, refereeNote: 'No show' }];
    writeScoringDraft(key, draft);
    expect(readScoringDraft(key)).toEqual(draft);
    localStorage.setItem(key, JSON.stringify([{ teamId: 1, place: 0, eliminated: true, status: 'DNS' }]));
    expect(readScoringDraft(key)).toBeNull();
    localStorage.setItem(key, JSON.stringify([{ teamId: 1, place: 1, eliminated: false, refereeNote: 5 }]));
    expect(readScoringDraft(key)).toBeNull();
  });
});

describe('scoring drafts', () => {
  const key = scoringDraftKey(4, 9);
  const draft: PendingPlace[] = [{ teamId: 2, place: 1, eliminated: false }, { teamId: 1, place: 0, eliminated: true }];

  it('is kept per heat and race', () => {
    expect(key).toBe('mg.draft.scoring:4:9');
    expect(scoringDraftKey(4, 10)).not.toBe(key);
  });

  it('is written, read back, and removed when emptied', () => {
    expect(readScoringDraft(key)).toBeNull();
    writeScoringDraft(key, draft);
    expect(readScoringDraft(key)).toEqual(draft);
    writeScoringDraft(key, []);
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('ignores a draft that is not a list of placings', () => {
    for (const bad of ['not json', '{"teamId":1}', '[]', '[{"teamId":"1","place":1,"eliminated":false}]', '[null]', '[{"teamId":1,"place":1}]']) {
      localStorage.setItem(key, bad);
      expect(readScoringDraft(key)).toBeNull();
    }
  });

  it('carries on when storage refuses', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    expect(readScoringDraft(key)).toBeNull();
    expect(() => writeScoringDraft(key, draft)).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
});
