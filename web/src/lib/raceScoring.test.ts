import { describe, expect, it } from 'vitest';
import { tapTeam, toggleEliminated, type PendingPlace } from './raceScoring';

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
