import { describe, expect, it } from 'vitest';
import { heat, race, result } from '../test/factories';
import {
  describePlacings, discard, enqueue, mergeOutboxBackup, nextToSend, outcomeOfError, overrule,
  parseOutboxBackup, placingsOf, retry, serializeOutboxBackup, settle,
  type Placing, type QueuedScore,
} from './scoreOutbox';

const mine: Placing[] = [{ teamId: 1, place: 1, eliminated: false }, { teamId: 2, place: 2, eliminated: false }];
const theirs: Placing[] = [{ teamId: 2, place: 1, eliminated: false }, { teamId: 1, place: 2, eliminated: false }];
const queued = (raceId: number, extra: Partial<QueuedScore> = {}): QueuedScore => ({
  raceId, competitionId: 1, sessionId: 1, label: `Race ${raceId}`, places: mine, expected: [], teamNames: {},
  queuedAt: `2026-06-01T10:0${raceId}:00Z`, state: 'waiting', ...extra,
});

describe('placingsOf', () => {
  it('turns results into placings, treating a missing placing as 0', () => {
    expect(placingsOf([result(1, 1), result(2, null, { eliminated: true })])).toEqual([
      { teamId: 1, place: 1, eliminated: false },
      { teamId: 2, place: 0, eliminated: true, status: 1 },
    ]);
  });

  it('keeps why a team did not finish', () => {
    expect(placingsOf([result(3, null, { eliminated: true, status: 2 })])).toEqual([{ teamId: 3, place: 0, eliminated: true, status: 2 }]);
  });

  it('preserves explicit points on queued placings', () => {
    const withPoints = queued(1, { places: [{ teamId: 1, place: 1, eliminated: false, points: 2.5, refereeNote: '[pts:2.5] Dead heat' }] });
    expect(enqueue([], withPoints)[0].places[0].points).toBe(2.5);
  });
});

describe('enqueue', () => {
  it('adds a save to the end of the queue', () => {
    expect(enqueue([queued(1)], queued(2)).map((q) => q.raceId)).toEqual([1, 2]);
  });

  it('replaces an earlier save for the same race and moves it to the end', () => {
    const newer = queued(1, { label: 'newer' });
    const list = enqueue([queued(1), queued(2)], newer);
    expect(list.map((q) => q.raceId)).toEqual([2, 1]);
    expect(list[1]).toBe(newer);
  });
});

describe('nextToSend', () => {
  it('picks the oldest waiting save, skipping conflicts and failures', () => {
    const list = [queued(1, { state: 'conflict' }), queued(2, { state: 'failed' }), queued(3), queued(4)];
    expect(nextToSend(list)?.raceId).toBe(3);
  });

  it('returns nothing when none is waiting', () => {
    expect(nextToSend([])).toBeUndefined();
    expect(nextToSend([queued(1, { state: 'failed' })])).toBeUndefined();
  });
});

describe('settle', () => {
  const sent = queued(1);
  const outcomeHeat = heat(5, { races: [race(1, { results: [result(2, 1), result(1, 2)] })] });

  it('removes a save the server accepted', () => {
    expect(settle([sent, queued(2)], sent, { kind: 'saved', sessionId: 1, heat: outcomeHeat }).map((q) => q.raceId)).toEqual([2]);
  });

  it('leaves everything as it was when the phone is offline', () => {
    const list = [sent];
    expect(settle(list, sent, { kind: 'offline' })).toBe(list);
  });

  it('records the other device’s results on a conflict', () => {
    const [after] = settle([sent], sent, { kind: 'conflict', sessionId: 1, heat: outcomeHeat });
    expect(after).toMatchObject({ state: 'conflict', theirs });
  });

  it('records no results when the conflicting heat has no such race', () => {
    const [after] = settle([sent], sent, { kind: 'conflict', sessionId: 1, heat: heat(5) });
    expect(after).toMatchObject({ state: 'conflict', theirs: [] });
  });

  it('records why a save failed', () => {
    const [after] = settle([sent], sent, { kind: 'failed', message: 'Nope' });
    expect(after).toMatchObject({ state: 'failed', error: 'Nope' });
  });

  it('leaves a newer save for the same race, queued while this one was in flight, alone', () => {
    const newer = queued(1, { queuedAt: '2026-06-01T11:00:00Z', label: 'newer' });
    const list = [newer];
    for (const outcome of [{ kind: 'failed', message: 'x' }, { kind: 'conflict', sessionId: 1, heat: outcomeHeat }] as const) {
      expect(settle(list, sent, outcome)).toBe(list);
    }
  });

  it('rebases an edit made while its earlier save was in flight', () => {
    const newer = queued(1, { saveId: 'new', queuedAt: sent.queuedAt, places: theirs });
    const old = { ...sent, saveId: 'old' };
    const accepted = heat(5, { races: [race(1, { results: [result(1, 1), result(2, 2)] })] });
    expect(settle([newer], old, { kind: 'saved', sessionId: 1, heat: accepted }))
      .toEqual([{ ...newer, expected: mine }]);
    expect(settle([newer], old, { kind: 'saved', sessionId: 1, heat: heat(5) })).toEqual([newer]);
    const refreshed = { ...newer, expected: theirs };
    expect(settle([refreshed], old, { kind: 'saved', sessionId: 1, heat: accepted })).toEqual([refreshed]);
    const conflicted = { ...newer, state: 'conflict' as const };
    expect(settle([conflicted, queued(2)], old, { kind: 'saved', sessionId: 1, heat: accepted })).toEqual([conflicted, queued(2)]);
  });

  it('only changes the save that was sent', () => {
    const other = queued(2);
    const after = settle([sent, other], sent, { kind: 'failed', message: 'x' });
    expect(after[1]).toBe(other);
  });
});

describe('overrule, retry and discard', () => {
  it('overrule re-queues a conflicted save against what the other device saved', () => {
    const [after] = overrule([queued(1, { state: 'conflict', theirs, expected: mine })], 1);
    expect(after).toMatchObject({ state: 'waiting', expected: theirs });
    expect(after.theirs).toBeUndefined();
  });

  it('overrule expects nothing when the other device’s results are not known', () => {
    expect(overrule([queued(1, { state: 'conflict', expected: mine })], 1)[0].expected).toEqual([]);
  });

  it('overrule leaves other races and unconflicted saves alone', () => {
    const list = [queued(1), queued(2, { state: 'conflict', theirs })];
    const after = overrule(list, 1);
    expect(after[0]).toBe(list[0]);
    expect(after[1]).toBe(list[1]);
  });

  it('retry makes a failed save wait again and clears its error', () => {
    const [after] = retry([queued(1, { state: 'failed', error: 'Nope' })], 1);
    expect(after.state).toBe('waiting');
    expect(after.error).toBeUndefined();
  });

  it('retry leaves other races and saves that did not fail alone', () => {
    const list = [queued(1), queued(2, { state: 'failed', error: 'x' })];
    const after = retry(list, 1);
    expect(after[0]).toBe(list[0]);
    expect(after[1]).toBe(list[1]);
  });

  it('discard drops every save for the race', () => {
    expect(discard([queued(1), queued(2)], 1).map((q) => q.raceId)).toEqual([2]);
    expect(discard([], 1)).toEqual([]);
  });
});

describe('outcomeOfError', () => {
  const fail = (status: number, data?: unknown) => ({ isAxiosError: true, response: { status, data } });
  const conflictHeat = heat(5);

  it.each([
    ['no answer at all', { isAxiosError: true }],
    ['a null error', null],
    ['an undefined error', undefined],
    ['a server error', fail(500)],
    ['a gateway error', fail(503)],
    ['a request timeout', fail(408)],
    ['rate limiting', fail(429)],
  ])('keeps the save for later on %s', (_label, err) => {
    expect(outcomeOfError(err)).toEqual({ kind: 'offline' });
  });

  it('words the failures for a scorer link, and still reports its conflicts', () => {
    expect(outcomeOfError(fail(401), true)).toMatchObject({ kind: 'failed', message: expect.stringContaining('lost its scorer link') });
    expect(outcomeOfError(fail(410), true)).toMatchObject({ kind: 'failed', message: expect.stringContaining('expired or been withdrawn') });
    expect(outcomeOfError(fail(404), true)).toMatchObject({ kind: 'failed', message: expect.stringContaining('isn’t in your arena') });
    expect(outcomeOfError(fail(403), true)).toMatchObject({ kind: 'failed', message: expect.stringContaining('can’t save scores') });
    expect(outcomeOfError(fail(409, { sessionId: 3, heat: conflictHeat }), true)).toMatchObject({ kind: 'conflict' });
    expect(outcomeOfError(fail(500), true)).toEqual({ kind: 'offline' });
    expect(outcomeOfError(fail(400, { message: 'Nope.' }), true)).toEqual({ kind: 'failed', message: 'Nope.' });
  });

  it('reports a conflict with the server’s heat', () => {
    expect(outcomeOfError(fail(409, { sessionId: 3, heat: conflictHeat }))).toEqual({ kind: 'conflict', sessionId: 3, heat: conflictHeat });
    expect(outcomeOfError(fail(409, { sessionId: 0, heat: conflictHeat }))).toMatchObject({ kind: 'conflict', sessionId: 0 });
  });

  it('treats a conflict without a heat or session as a rejection', () => {
    expect(outcomeOfError(fail(409))).toMatchObject({ kind: 'failed' });
    expect(outcomeOfError(fail(409, { sessionId: 3 }))).toMatchObject({ kind: 'failed' });
    expect(outcomeOfError(fail(409, { heat: conflictHeat }))).toMatchObject({ kind: 'failed' });
  });

  it('explains being signed out, not being an admin, and a deleted race', () => {
    expect(outcomeOfError(fail(401))).toEqual({ kind: 'failed', message: 'You’ve been signed out. Sign in again, then tap Try again.' });
    expect(outcomeOfError(fail(403))).toEqual({ kind: 'failed', message: 'Only admins can save scores. Sign in with an admin account, then tap Try again.' });
    expect(outcomeOfError(fail(404))).toEqual({ kind: 'failed', message: 'This race no longer exists.' });
  });

  it('shows the server’s message for other rejections, or a general one', () => {
    expect(outcomeOfError(fail(400, { message: 'Places must be unique.' }))).toEqual({ kind: 'failed', message: 'Places must be unique.' });
    expect(outcomeOfError(fail(400, {}))).toEqual({ kind: 'failed', message: 'These results were rejected. Check them and score the race again.' });
    expect(outcomeOfError(fail(422))).toMatchObject({ kind: 'failed' });
  });
});

describe('describePlacings', () => {
  it('lists placings in order with ordinals, eliminated teams last', () => {
    const places: Placing[] = [
      { teamId: 3, place: 0, eliminated: true },
      { teamId: 2, place: 2, eliminated: false },
      { teamId: 1, place: 1, eliminated: false },
    ];
    expect(describePlacings(places, { 1: 'Red Rum', 2: 'Shergar', 3: 'Arkle' })).toBe('1st Red Rum · 2nd Shergar · Arkle out');
  });

  it('falls back to the team number when a name is missing', () => {
    expect(describePlacings([{ teamId: 9, place: 1, eliminated: false }], {})).toBe('1st Team 9');
  });

  it('uses the right ordinal suffixes', () => {
    const places = [1, 2, 3, 4, 11, 12, 13, 21].map((place) => ({ teamId: place, place, eliminated: false }));
    expect(describePlacings(places, {}).split(' · ').map((p) => p.split(' ')[0])).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st']);
  });

  it('says so when there are no results and does not reorder the input', () => {
    expect(describePlacings([], {})).toBe('No results');
    const places = [{ teamId: 2, place: 2, eliminated: false }, { teamId: 1, place: 1, eliminated: false }];
    describePlacings(places, {});
    expect(places.map((p) => p.teamId)).toEqual([2, 1]);
  });
});

describe('serializeOutboxBackup, parseOutboxBackup and mergeOutboxBackup', () => {
  it('serialises only the target competition’s queued scores and parses them back as waiting', () => {
    const list = [
      queued(1, { saveId: 's1', reason: '  Photo finish ', teamNames: { 1: 'Red Rum', 2: 'Shergar' }, state: 'failed', error: 'Offline' }),
      queued(2, { competitionId: 99 }),
    ];
    const json = serializeOutboxBackup(list, 1, '2026-06-01T12:00:00Z');
    const parsed = parseOutboxBackup(json, 1);
    expect(parsed).toHaveLength(1);
    expect(parsed![0]).toMatchObject({
      saveId: 's1',
      raceId: 1,
      competitionId: 1,
      sessionId: 1,
      label: 'Race 1',
      reason: 'Photo finish',
      teamNames: { 1: 'Red Rum', 2: 'Shergar' },
      state: 'waiting',
    });
    expect(parsed![0].error).toBeUndefined();
  });

  it('accepts a raw array, applies fallback competitionId and viaLink overrides, and merges into existing outbox', () => {
    const raw = JSON.stringify([
      {
        raceId: 3,
        sessionId: 2,
        label: '  Heat 1 · Flag ',
        places: mine,
        expected: 'not-an-array',
        teamNames: { 1: 'Oak A', bad: 123 },
        queuedAt: '',
        viaLink: true,
      },
    ]);
    const parsedKeepLink = parseOutboxBackup(raw, 7);
    expect(parsedKeepLink![0].competitionId).toBe(7);
    expect(parsedKeepLink![0].viaLink).toBe(true);
    expect(parsedKeepLink![0].expected).toEqual([]);
    expect(parsedKeepLink![0].teamNames).toEqual({ 1: 'Oak A' });
    expect(parsedKeepLink![0].queuedAt).toBeTruthy();

    const parsedStripLink = parseOutboxBackup(raw, 7, false);
    expect(parsedStripLink![0].viaLink).toBeUndefined();

    const merged = mergeOutboxBackup([queued(1), queued(3, { label: 'Old' })], parsedStripLink!);
    expect(merged.map((q) => q.raceId)).toEqual([1, 3]);
    expect(merged[1].label).toBe('Heat 1 · Flag');
  });

  it('rejects invalid JSON or malformed backup entries', () => {
    expect(parseOutboxBackup('not-json', 1)).toBeNull();
    expect(parseOutboxBackup('{}', 1)).toBeNull();
    expect(parseOutboxBackup('[]', 1)).toBeNull();
    expect(parseOutboxBackup('[null]', 1)).toBeNull();
    expect(parseOutboxBackup('[{"raceId":0,"sessionId":1,"label":"x","places":[]}]', 1)).toBeNull();
    expect(parseOutboxBackup('[{"raceId":1,"sessionId":1,"label":"x","places":[null]}]', 1)).toBeNull();
    expect(parseOutboxBackup('[{"raceId":1,"sessionId":1,"label":"x","places":[{"teamId":1,"place":1,"eliminated":"no"}]}]', 1)).toBeNull();
  });
});
