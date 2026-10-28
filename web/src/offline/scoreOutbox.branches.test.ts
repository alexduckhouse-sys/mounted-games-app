import { describe, expect, it } from 'vitest';
import { heat, race, result } from '../test/factories';
import {
  describePlacings,
  mergeOutboxBackup,
  overrule,
  parseOutboxBackup,
  retry,
  settle,
  type Placing,
  type QueuedScore,
} from './scoreOutbox';

const place = (teamId: number, p: number, extra: Partial<Placing> = {}): Placing => ({ teamId, place: p, eliminated: false, ...extra });

const queued = (raceId: number, extra: Partial<QueuedScore> = {}): QueuedScore => ({
  saveId: `s${raceId}`,
  raceId,
  competitionId: 1,
  sessionId: 7,
  label: `Race ${raceId}`,
  places: [place(1, 1)],
  expected: [],
  teamNames: {},
  queuedAt: '2026-06-01T10:00:00Z',
  state: 'waiting',
  ...extra,
});

describe('settle edge cases', () => {
  it('stores empty "theirs" when a conflict reply no longer has the race', () => {
    const q = queued(1);
    const out = settle([q], q, { kind: 'conflict', sessionId: 7, heat: heat(1, { races: [] }) });
    expect(out[0]).toMatchObject({ state: 'conflict', theirs: [] });
  });

  it('rebases a corrected save onto what the server accepted, comparing points and statuses', () => {
    const sent = queued(1, { saveId: 'old', expected: [place(1, 0, { eliminated: true, status: 2, points: 1.5 }), place(2, 1, { points: Number.NaN })] });
    const correction = queued(1, {
      saveId: 'new',
      expected: [place(2, 1, { points: Number.NaN }), place(1, 0, { eliminated: true, status: 2, points: 1.5 })],
    });
    const accepted = heat(1, { races: [race(1, { results: [result(1, null, { eliminated: true, status: 3 }), result(2, 1)] })] });
    const out = settle([correction], sent, { kind: 'saved', sessionId: 7, heat: accepted });
    expect(out[0].expected).toEqual([
      { teamId: 1, place: 0, eliminated: true, status: 3 },
      { teamId: 2, place: 1, eliminated: false },
    ]);
  });

  it('leaves a differing correction, a non-waiting save and unrelated outcomes alone', () => {
    const sent = queued(1, { saveId: 'old', expected: [place(1, 1)] });
    const differing = queued(1, { saveId: 'new', expected: [place(1, 2)] });
    const conflicting = queued(1, { saveId: 'newer', state: 'conflict', expected: [place(1, 1)] });
    const accepted = heat(1, { races: [race(1, { results: [result(1, 1)] })] });
    const out = settle([differing, conflicting], sent, { kind: 'saved', sessionId: 7, heat: accepted });
    expect(out).toEqual([differing, conflicting]);
    expect(settle([differing], sent, { kind: 'offline' })).toEqual([differing]);
    expect(settle([differing], sent, { kind: 'saved', sessionId: 7, heat: heat(1, { races: [] }) })).toEqual([differing]);
  });
});

describe('overrule and retry reasons', () => {
  it('records a reason when given, and keeps the old one otherwise', () => {
    const conflict = queued(1, { state: 'conflict', theirs: [place(2, 1)], reason: 'old' });
    expect(overrule([conflict], 1, 'because')[0]).toMatchObject({ state: 'waiting', reason: 'because', expected: [place(2, 1)] });
    expect(overrule([conflict], 1)[0]).toMatchObject({ state: 'waiting', reason: 'old' });
    expect(overrule([{ ...conflict, theirs: undefined }], 1)[0].expected).toEqual([]);
    expect(overrule([conflict], 2)[0]).toBe(conflict);

    const failed = queued(1, { state: 'failed', error: 'x' });
    expect(retry([failed], 1, 'again')[0]).toMatchObject({ state: 'waiting', reason: 'again', error: undefined });
    expect(retry([failed], 1)[0]).not.toHaveProperty('reason');
    expect(retry([queued(1)], 1)[0].state).toBe('waiting');
  });
});

describe('describePlacings status wording', () => {
  it('names eliminations by status, falls back to team ids and orders finishers first', () => {
    const text = describePlacings(
      [place(3, 0, { eliminated: true }), place(2, 2), place(4, 0, { eliminated: true, status: 2 }), place(1, 1)],
      { 1: 'Red Rum', 2: 'Shergar' },
    );
    expect(text).toBe('1st Red Rum · 2nd Shergar · Unnamed team out · Unnamed team DNS');
    expect(describePlacings([], {})).toBe('No results');
  });
});

describe('parseOutboxBackup competition id resolution', () => {
  const item = (extra: Record<string, unknown> = {}) => ({
    raceId: 3,
    sessionId: 4,
    label: ' Heat 1 ',
    places: [place(1, 1)],
    ...extra,
  });

  it('takes the id from the item, then the backup, then the fallback', () => {
    expect(parseOutboxBackup(JSON.stringify({ competitionId: 9, scores: [item()] }))?.[0].competitionId).toBe(9);
    expect(parseOutboxBackup(JSON.stringify({ competitionId: 9, scores: [item({ competitionId: 5 })] }))?.[0].competitionId).toBe(5);
    expect(parseOutboxBackup(JSON.stringify([item()]), 6)?.[0].competitionId).toBe(6);
    expect(parseOutboxBackup(JSON.stringify([item({ competitionId: -4 })]), 6)?.[0].competitionId).toBe(6);
  });

  it('rejects an item with no competition id anywhere, or one for another competition', () => {
    expect(parseOutboxBackup(JSON.stringify([item()]))).toBeNull();
    expect(parseOutboxBackup(JSON.stringify([item({ competitionId: -1 })]))).toBeNull();
    expect(parseOutboxBackup(JSON.stringify([item({ competitionId: 2 })]), 6)).toBeNull();
    expect(parseOutboxBackup(JSON.stringify({ competitionId: 'x', scores: [item()] }), 6)?.[0].competitionId).toBe(6);
    expect(parseOutboxBackup('null', 6)).toBeNull();
  });

  it('cleans optional fields and applies the via-link override', () => {
    const [parsed] = parseOutboxBackup(
      JSON.stringify([
        item({
          competitionId: 1,
          saveId: 'abc',
          expected: 'bad',
          teamNames: { 1: 'Red', x: 'Nope', 2: 7 },
          reason: '  because ',
          viaLink: true,
          queuedAt: '',
        }),
      ]),
    )!;
    expect(parsed).toMatchObject({ saveId: 'abc', expected: [], teamNames: { 1: 'Red' }, reason: 'because', viaLink: true, label: 'Heat 1' });
    expect(Date.parse(parsed.queuedAt)).not.toBeNaN();
    const [off] = parseOutboxBackup(JSON.stringify([item({ competitionId: 1, viaLink: true })]), undefined, false)!;
    expect(off).not.toHaveProperty('viaLink');
    const [on] = parseOutboxBackup(JSON.stringify([item({ competitionId: 1 })]), undefined, true)!;
    expect(on.viaLink).toBe(true);
  });
});

describe('mergeOutboxBackup timestamps', () => {
  it('keeps a newer local save, replaces an older one and tolerates bad dates', () => {
    const local = queued(1, { queuedAt: '2026-06-01T12:00:00Z', places: [place(1, 1)] });
    const older = queued(1, { queuedAt: '2026-06-01T09:00:00Z', places: [place(1, 2)], saveId: 'imp' });
    expect(mergeOutboxBackup([local], [older])).toEqual([local]);

    const newer = queued(1, { queuedAt: '2026-06-01T15:00:00Z', places: [place(1, 3)], saveId: 'imp2' });
    expect(mergeOutboxBackup([local], [newer])).toEqual([newer]);

    const broken = queued(1, { queuedAt: 'not a date', saveId: 'imp3' });
    expect(mergeOutboxBackup([local], [broken])).toEqual([broken]);
    expect(mergeOutboxBackup([], [older])).toEqual([older]);
  });
});
