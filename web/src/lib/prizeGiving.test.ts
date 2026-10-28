import { describe, expect, it } from 'vitest';
import type { DeclarationForm } from '../types';
import { parsePrizeGiving, revealOrder, riderLines } from './prizeGiving';
import type { Toplist, ToplistRow } from './toplist';

describe('parsePrizeGiving', () => {
  const place = { teamId: 7, place: 1, teamName: 'Thunder', clubName: 'Cheshire PC', points: 44.5 };

  it('reads a step, a clear and nothing else', () => {
    expect(parsePrizeGiving({ action: 'show', sectionId: 3, sectionName: 'Open', places: [place], champions: true }))
      .toEqual({ sectionId: 3, sectionName: 'Open', places: [place], champions: true });
    expect(parsePrizeGiving({ action: 'show', sectionId: 3, places: [{ ...place, clubName: null }] }))
      .toEqual({ sectionId: 3, sectionName: '', places: [{ ...place, clubName: null }], champions: false });
    expect(parsePrizeGiving({ action: 'clear' })).toBe('clear');
  });

  it('ignores anything malformed', () => {
    for (const raw of [null, 'show', { action: 'dance' }, { action: 'show', places: [place] }, { action: 'show', sectionId: 3 },
      { action: 'show', sectionId: 3, places: [] }, { action: 'show', sectionId: 3, places: [null] },
      { action: 'show', sectionId: 3, places: [{ ...place, points: Number.NaN }] }, { action: 'show', sectionId: 3, places: [{ ...place, teamName: 4 }] }]) {
      expect(parsePrizeGiving(raw)).toBeNull();
    }
  });
});

describe('revealOrder', () => {
  const row = (teamId: number, position: number, points: number, joint = false) => ({ teamId, teamName: `Team ${teamId}`, position, points, joint }) as ToplistRow;
  const toplist = { rows: [row(1, 1, 50), row(2, 2, 40), row(3, 3, 30, true), row(4, 3, 30, true), row(5, 5, 20), row(6, 6, 10)], hc: [{ teamId: 2, teamName: 'Team 2', points: 40, racesLeft: 0 }] } as unknown as Toplist;

  it('gives the top places last first, leaving out hors concours and keeping teams level on a place together', () => {
    expect(revealOrder(toplist, 3).map((p) => [p.teamId, p.place, p.joint])).toEqual([[4, 3, true], [3, 3, true], [1, 1, false]]);
    expect(revealOrder(toplist, 6)).toHaveLength(5);
    expect(revealOrder(toplist, 1)[0]).toEqual({ teamId: 1, teamName: 'Team 1', place: 1, joint: false, points: 50 });
  });
});

describe('riderLines', () => {
  const rider = (fullName: string, orderIndex: number, horseName: string | null, isReserve = false) => ({ id: orderIndex, fullName, orderIndex, horseName, isReserve, isCaptain: false });
  const form = (id: number, teamId: number, submittedAt: string, riders: ReturnType<typeof rider>[]) => ({ id, teamId, submittedAt, riders }) as unknown as DeclarationForm;

  it('reads the latest form for the team, in team order with the reserve last', () => {
    const forms = [
      form(1, 7, '2026-10-01T09:00:00Z', [rider('Old Rider', 0, 'Old Pony')]),
      form(2, 7, '2026-10-02T09:00:00Z', [rider('Ruby Fox', 0, 'Toffee', true), rider('Josh Hart', 2, ' '), rider('Amy Lee', 1, 'Biscuit')]),
      form(3, 8, '2026-10-03T09:00:00Z', [rider('Someone Else', 0, 'Pony')]),
    ];
    expect(riderLines(forms, 7)).toEqual([
      { rider: 'Amy Lee', pony: 'Biscuit', reserve: false },
      { rider: 'Josh Hart', pony: null, reserve: false },
      { rider: 'Ruby Fox', pony: 'Toffee', reserve: true },
    ]);
    expect(riderLines(forms, 9)).toEqual([]);
  });

  it('shows a rider who asked for initial-only by their surname initial', () => {
    const forms = [form(1, 7, '2026-10-02T09:00:00Z', [{ ...rider('Amy Lee', 0, 'Biscuit'), useInitialOnly: true } as unknown as ReturnType<typeof rider>])];
    expect(riderLines(forms, 7)).toEqual([{ rider: 'Amy L.', pony: 'Biscuit', reserve: false }]);
  });
});
