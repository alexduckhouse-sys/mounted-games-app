import { describe, expect, it } from 'vitest';
import { heat, race, result, session } from '../test/factories';
import { TieBreakRule, type Heat, type Race } from '../types';
import { ELIM_REASONS, noteFor, reasonKeyOf, statusFor } from './elimReasons';
import { nextRoundLanes } from './nextRoundLanes';
import { heatTotals, summariseRace } from './raceSummary';
import { dropDrafts, pushUndo, undoSave, UNDO_LIMIT, type DraftUndo, type SaveUndo } from './scoreUndo';
import type { QueuedScore } from '../offline/scoreOutbox';

const entries = (...names: string[]): Heat['entries'] => names.map((teamName, i) => ({ id: i + 1, teamId: i + 1, teamName, laneIndex: i + 1 }));
const scored = (id: number, rows: [number, number | null, number, boolean?][], extra: Partial<Race> = {}): Race =>
  race(id, { name: `Race ${id}`, isComplete: true, orderIndex: id, results: rows.map(([teamId, placing, points, eliminated]) => result(teamId, placing, { points, eliminated: eliminated ?? false })), ...extra });
const none = new Set<number>();

describe('elimination reasons', () => {
  it('stores a preset as its wording and Other as the free text', () => {
    expect(noteFor('flag', '')).toBe('Missed a flag or pot');
    expect(noteFor('other', '  Fell off  ')).toBe('Fell off');
    expect(noteFor('nonsense', 'x')).toBe('x');
    expect(reasonKeyOf('Crossed lanes')).toBe('lanes');
    expect(reasonKeyOf('Fell off')).toBe('other');
    expect(reasonKeyOf('  ')).toBeNull();
    expect(reasonKeyOf(undefined)).toBeNull();
  });
  it('sets a non-finish status for did not start, did not finish and retired', () => {
    expect(statusFor('dns')).toBe(2);
    expect(statusFor('dnf')).toBe(3);
    expect(statusFor('retired')).toBe(4);
    expect(statusFor('flag')).toBe(1);
    expect(statusFor('unknown')).toBe(1);
    expect(ELIM_REASONS.map((r) => r.label)).toContain('Wrong course');
  });
});

describe('race summary', () => {
  const h = heat(1, { entries: entries('Alpha', 'Bravo', 'Charlie'), raceRoundStage: 0 });
  const r1 = scored(1, [[2, 1, 3], [3, 2, 2], [1, null, 0, true]]);
  const r2 = scored(2, [[1, 1, 3], [3, 2, 2], [2, 3, 1]]);

  it('lists placings, who is out and why, and the running totals', () => {
    const s = summariseRace({ heat: h, races: [r1, r2], raceIndex: 0, hcTeamIds: none, rule: TieBreakRule.Countback, qualifiers: 3, notes: { 1: 'Missed a flag or pot' } })!;
    expect(s.placings.map((p) => `${p.place} ${p.teamName}`)).toEqual(['1 Bravo', '2 Charlie']);
    expect(s.out).toEqual([{ teamId: 1, teamName: 'Alpha', reason: 'Missed a flag or pot' }]);
    expect(s.totals.map((t) => `${t.teamName} ${t.points}`)).toEqual(['Bravo 3', 'Charlie 2', 'Alpha 0']);
    expect(s.ending).toBeNull();
  });

  it('falls back to the status when no reason was written', () => {
    const s = summariseRace({ heat: h, races: [r1], raceIndex: 0, hcTeamIds: none, rule: TieBreakRule.Countback, qualifiers: 3, notes: {} })!;
    expect(s.out[0].reason).toBe('Eliminated');
  });

  it('is null until the race is complete or when it does not exist', () => {
    expect(summariseRace({ heat: h, races: [race(1)], raceIndex: 0, hcTeamIds: none, rule: 0, qualifiers: 3, notes: {} })).toBeNull();
    expect(summariseRace({ heat: h, races: [], raceIndex: 3, hcTeamIds: none, rule: 0, qualifiers: 3, notes: {} })).toBeNull();
  });

  it('ends a heat with the result and says which team is ahead on tie-break', () => {
    // Alpha 3+0 = 3, Bravo 3+1 = 4... make a tie: Charlie 2+2 = 4, Bravo 3+1 = 4: Bravo has a win.
    const s = summariseRace({ heat: h, races: [r1, r2], raceIndex: 1, hcTeamIds: none, rule: TieBreakRule.Countback, qualifiers: 3, notes: {} })!;
    expect(s.ending?.heading).toBe('Heat result');
    expect(s.ending?.lines[0]).toBe('1st Bravo: 4 points, ahead on tie-break: most wins');
    expect(s.ending?.lines[1]).toBe('2nd Charlie: 4 points');
    expect(s.ending?.lines).toContain('3rd Alpha: 3 points');
  });

  it('uses the last race when that is the rule, and leaves it to the organiser for a run-off', () => {
    const lastRace = heatTotals(h, [r1, r2], 1, none, TieBreakRule.LastRace);
    expect(lastRace.map((t) => t.teamName)).toEqual(['Charlie', 'Bravo', 'Alpha']);
    expect(lastRace[0].why).toBe('better score in the most recent race');
    const runOff = heatTotals(h, [r1, r2], 1, none, TieBreakRule.RunOff);
    expect(runOff[0].position).toBe(1);
    expect(runOff[1].position).toBe(1);
    const s = summariseRace({ heat: h, races: [r1, r2], raceIndex: 1, hcTeamIds: none, rule: TieBreakRule.RunOff, qualifiers: 3, notes: {} })!;
    expect(s.ending?.lines).toContain('Teams are level on points: the organiser decides the order.');
  });

  it('says some teams are still level when the tie-break cannot separate them', () => {
    const level = heat(1, { entries: entries('A', 'B') });
    const a = scored(1, [[1, 1, 2], [2, 2, 1]]);
    const b = scored(2, [[2, 1, 2], [1, 2, 1]]);
    const s = summariseRace({ heat: level, races: [a, b], raceIndex: 1, hcTeamIds: none, rule: TieBreakRule.Countback, qualifiers: 3, notes: {} })!;
    expect(s.ending?.lines.at(-1)).toBe('Some teams are still level after the tie-break: the organiser decides the order.');
  });

  it('lists an HC team after the ranked teams, without a position', () => {
    const totals = heatTotals(h, [r1, r2], 1, new Set([2]), TieBreakRule.Countback);
    expect(totals.map((t) => `${t.teamName}:${t.position}`)).toEqual(['Charlie:1', 'Alpha:2', 'Bravo:null']);
    const s = summariseRace({ heat: h, races: [r1, r2], raceIndex: 1, hcTeamIds: new Set([2]), rule: 0, qualifiers: 3, notes: {} })!;
    expect(s.ending?.lines.at(-1)).toBe('Bravo: hors concours, 4 points, not ranked');
    expect(s.placings.find((p) => p.teamId === 2)?.hc).toBe(true);
  });

  it('after a qualifier says who goes through and why the others do not', () => {
    const q = heat(1, { raceRoundStage: 1, entries: entries('A', 'B', 'C', 'D', 'E') });
    const only = scored(1, [[3, 1, 1], [1, 2, 1], [2, 3, 1], [4, 4, 1], [5, null, 0, true]]);
    const s = summariseRace({ heat: q, races: [only], raceIndex: 0, hcTeamIds: none, rule: 0, qualifiers: 3, notes: { 5: 'Wrong course' } })!;
    expect(s.ending?.heading).toBe('Through to the final');
    expect(s.ending?.lines).toEqual([
      'C: qualified 1st, through to the final',
      'A: qualified 2nd, through to the final',
      'B: qualified 3rd, through to the final',
      'D: not through. Placed 4th and only the top 3 go through',
      'E: out of the qualifier. Wrong course',
    ]);
  });

  it('calls the last race of a final the final result', () => {
    const f = heat(2, { raceRoundStage: 2, entries: entries('A', 'B') });
    const s = summariseRace({ heat: f, races: [scored(1, [[1, 1, 3], [2, 2, 2]])], raceIndex: 0, hcTeamIds: none, rule: 0, qualifiers: 3, notes: {} })!;
    expect(s.ending?.heading).toBe('Final result');
  });
});

describe('next round lanes', () => {
  const q1 = heat(1, { orderIndex: 1, raceRoundId: 7, raceRoundStage: 1, label: 'Heat 1 · Q1', entries: entries('A', 'B', 'C'), races: [scored(1, [[1, 1, 1], [2, 2, 1], [3, 3, 1]])] });
  const q2 = heat(2, { orderIndex: 2, raceRoundId: 7, raceRoundStage: 1, label: 'Heat 2 · Q2', entries: [{ id: 11, teamId: 11, teamName: 'X', laneIndex: 1 }, { id: 12, teamId: 12, teamName: 'Y', laneIndex: 2 }, { id: 13, teamId: 13, teamName: 'Z', laneIndex: 3 }], races: [scored(2, [[12, 1, 1], [11, 2, 1], [13, 3, 1]])] });
  const finalHeat = (extra: Partial<Heat> = {}) => heat(3, { orderIndex: 3, raceRoundId: 7, raceRoundStage: 2, label: 'A Final', ...extra });

  it('is null until both qualifiers are finished', () => {
    const half = { ...q2, races: [race(2)] };
    expect(nextRoundLanes(session(1, { heats: [q1, half, finalHeat()] }), q1, null, 2)).toBeNull();
  });

  it('shows the final provisionally from the qualifier placings, Q1 first, when the server has not filled it', () => {
    const s = session(1, { heats: [q1, q2, finalHeat()], lanesPerHeat: 4 });
    const lanes = nextRoundLanes(s, q1, null, 2)!;
    expect(lanes.provisional).toBe(true);
    expect(lanes.note).toMatch(/Provisional/);
    expect(lanes.rows.map((r) => `${r.lane} ${r.teamName}`)).toEqual(['1 A', '2 Y', '3 B', '4 X']);
  });

  it('stops at the number of lanes, and with no lane limit takes everyone through', () => {
    const limited = nextRoundLanes(session(1, { heats: [q1, q2, finalHeat()], lanesPerHeat: 3 }), q1, null, 2)!;
    expect(limited.rows).toHaveLength(3);
    const open = nextRoundLanes(session(1, { heats: [q1, q2, finalHeat()] }), q1, null, 1)!;
    expect(open.rows.map((r) => r.teamName)).toEqual(['A', 'Y']);
  });

  it('shows the lanes the server gave the final once it is filled', () => {
    const filled = finalHeat({ entries: [{ id: 21, teamId: 12, teamName: 'Y', laneIndex: 2 }, { id: 22, teamId: 1, teamName: 'A', laneIndex: 1 }] });
    const lanes = nextRoundLanes(session(1, { heats: [q1, q2, filled] }), q2, null, 2)!;
    expect(lanes.provisional).toBe(false);
    expect(lanes.rows.map((r) => `${r.lane} ${r.teamName}`)).toEqual(['1 A', '2 Y']);
  });

  it('after the final is done, shows the next heat’s lanes', () => {
    const done = finalHeat({ entries: entries('A', 'B'), races: [scored(3, [[1, 1, 2], [2, 2, 1]])] });
    const next = heat(9, { label: 'Heat 3', entries: entries('M', 'N') });
    const lanes = nextRoundLanes(session(1, { heats: [q1, q2, done, next] }), done, next, 3)!;
    expect(lanes.title).toBe('Lanes for Heat 3');
    expect(lanes.rows.map((r) => r.teamName)).toEqual(['M', 'N']);
    expect(nextRoundLanes(session(1, { heats: [q1, q2, done] }), done, null, 3)).toBeNull();
    expect(nextRoundLanes(session(1, { heats: [q1, q2, finalHeat()] }), finalHeat(), next, 3)).toBeNull();
  });
});

describe('undo', () => {
  const queued = (saveId: string, extra: Partial<QueuedScore> = {}): QueuedScore => ({
    saveId, raceId: 5, competitionId: 1, sessionId: 1, label: 'Heat 1 · Race 5', teamNames: { 1: 'A', 2: 'B' }, queuedAt: '2026-10-23T10:00:00Z', state: 'waiting',
    places: [{ teamId: 1, place: 1, eliminated: false }, { teamId: 2, place: 2, eliminated: false }],
    expected: [], ...extra,
  });
  const draft = [{ teamId: 1, place: 1, eliminated: false }];
  const entry = (sent: QueuedScore, queuedBefore: QueuedScore | null = null): SaveUndo => ({ kind: 'save', raceId: 5, sent, queuedBefore, draft });

  it('keeps the last few actions, and forgets drafts but not saves when a race changes', () => {
    let stack = [] as ReturnType<typeof pushUndo>;
    for (let i = 0; i < UNDO_LIMIT + 3; i++) stack = pushUndo(stack, { kind: 'draft', raceId: 5, places: [] });
    expect(stack).toHaveLength(UNDO_LIMIT);
    const save = entry(queued('a'));
    const d: DraftUndo = { kind: 'draft', raceId: 6, places: [] };
    expect(dropDrafts([d, save])).toEqual([save]);
    expect(dropDrafts([d, { ...d, raceId: 5 }, save], 6)).toEqual([{ ...d, raceId: 5 }, save]);
  });

  it('cancels a save that is still waiting and restores what it replaced', () => {
    const before = queued('older');
    const sent = queued('newer');
    const out = undoSave([sent], entry(sent, before));
    expect(out.how).toBe('cancelled');
    expect(out.outbox).toEqual([before]);
    expect(out.restore).toEqual(draft);
    expect(undoSave([sent], entry(sent)).outbox).toEqual([]);
  });

  it('cancels a save that failed or hit a conflict too, since it never reached the server', () => {
    const sent = queued('n', { state: 'conflict' });
    expect(undoSave([sent], entry(sent)).how).toBe('cancelled');
  });

  it('sends the earlier results back as a correction once the save has gone through', () => {
    const prior = [{ teamId: 2, place: 1, eliminated: false }, { teamId: 1, place: 2, eliminated: false }];
    const sent = queued('gone', { expected: prior });
    const other = queued('x', { raceId: 9 });
    const out = undoSave([other], entry(sent), new Date('2026-10-23T11:00:00Z'));
    expect(out.how).toBe('corrected');
    expect(out.restore).toEqual([]);
    const correction = out.outbox.find((q) => q.raceId === 5)!;
    expect(correction.places).toEqual(prior);
    expect(correction.expected).toEqual(sent.places);
    expect(correction.reason).toMatch(/^Undo/);
    expect(correction.saveId).not.toBe('gone');
    expect(correction.state).toBe('waiting');
    expect(out.outbox).toContain(other);
  });

  it('reopens the race for correction when a sent save had nothing before it', () => {
    const sent = queued('first', { expected: [] });
    const out = undoSave([], entry(sent));
    expect(out).toEqual({ outbox: [], restore: draft, how: 'reopened' });
  });
});
