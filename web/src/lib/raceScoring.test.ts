import { describe, expect, it } from 'vitest';
import type { Heat } from '../types';
import { heat, race } from '../test/factories';
import { nextRaceToScore, tapTeam, toggleEliminated, type PendingPlace } from './raceScoring';

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
