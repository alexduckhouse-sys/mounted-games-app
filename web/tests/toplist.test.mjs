import test from 'node:test';
import assert from 'node:assert/strict';
import { buildToplist, ordinal, toplistNote } from '../src/lib/toplist.ts';

const standing = (teamId, totalPoints) => ({ teamId, teamName: `Team ${teamId}`, clubName: 'Club', totalPoints, racesRun: 1, wins: 0, eliminations: 0 });
const race = (id, complete, results = []) => ({ id, heatId: 1, name: `Race ${id}`, orderIndex: id, isComplete: complete, results });
const heat = (id, teamIds, races, extra = {}) => ({ id, sessionId: 1, orderIndex: id, entries: teamIds.map((teamId, lane) => ({ id: teamId, teamId, teamName: `Team ${teamId}`, laneIndex: lane })), races, ...extra });
const session = (id, heats, extra = {}) => ({ id, competitionId: 1, competitionSectionId: 9, sectionName: 'Seniors', name: 'Seniors heats', status: 0, orderIndex: id, isBreak: false, kind: 0, heats, ...extra });
const team = (id, extra = {}) => ({ id, competitionId: 1, competitionSectionId: 9, sectionName: 'Seniors', clubId: 1, clubName: 'Club', suffix: 'A', displayName: `Team ${id}`, isHorsConcours: false, ...extra });

test('ordinals read naturally', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st']);
});

test('tied teams share a position and the next team skips it', () => {
  const list = buildToplist([standing(1, 10), standing(2, 8), standing(3, 8), standing(4, 5)], [], [], 9, null);
  assert.deepEqual(list.rows.map((row) => [row.position, row.joint]), [[1, false], [2, true], [2, true], [4, false]]);
});

test('no final places set means no cut-off line', () => {
  const list = buildToplist([standing(1, 10), standing(2, 8), standing(3, 6)], [], [], 9, null);
  assert.equal(list.cutAfter, null);
  assert.ok(list.rows.every((row) => !row.out && row.needed == null));
});

test('the line sits under the last finalist and teams below it see what they need', () => {
  const sessions = [session(1, [heat(1, [3, 90, 91], [race(1, false), race(2, false)])])];
  const list = buildToplist([standing(1, 10), standing(2, 8), standing(3, 5)], sessions, [team(90, { isHorsConcours: true }), team(91, { isHorsConcours: true })], 9, 2);
  assert.equal(list.cutAfter, 1);
  assert.equal(list.runoff, null);
  assert.equal(list.rows[2].out, true);
  assert.equal(list.rows[2].needed, 6);
  assert.equal(toplistNote(list.rows[2]), '6 pts needed for the A Final (normal finishes)');
});

test('a tie across the line becomes a run-off and the line moves below the tied teams', () => {
  const list = buildToplist([standing(1, 12), standing(2, 9), standing(3, 9), standing(4, 4)], [], [], 9, 2);
  assert.deepEqual(list.runoff?.teams.map((row) => row.teamId), [2, 3]);
  assert.equal(list.runoff?.place, 2);
  assert.equal(list.cutAfter, 2);
  assert.equal(toplistNote(list.rows[1]), 'Joint 2nd · run-off');
  assert.equal(list.rows[3].out, true);
});

test('before anyone scores there is no line, even with final places set', () => {
  const list = buildToplist([standing(1, 0), standing(2, 0), standing(3, 0)], [], [], 9, 2);
  assert.equal(list.cutAfter, null);
  assert.equal(list.runoff, null);
});

test('races left, sessions done and points per session come from the heats, ignoring finals', () => {
  const done = session(1, [heat(1, [1, 2], [race(1, true, [{ id: 1, teamId: 1, teamName: 'Team 1', placing: 1, eliminated: false, points: 2 }, { id: 2, teamId: 2, teamName: 'Team 2', placing: 2, eliminated: false, points: 1 }])])], { status: 2 });
  const next = session(2, [heat(2, [1, 2], [race(2, false), race(3, false)])]);
  const finals = session(3, [heat(3, [1, 2], [race(4, false)])], { name: 'Seniors finals' });
  const list = buildToplist([standing(1, 2), standing(2, 1)], [done, next, finals], [], 9, null);
  assert.equal(list.sessionsDone, 1);
  assert.equal(list.sessionsTotal, 2);
  assert.equal(list.rows[0].racesLeft, 2);
  assert.equal(toplistNote(list.rows[0]), '2 races left');
  assert.deepEqual(list.bySession.sessions.map((s) => s.label), ['S1', 'S2']);
  assert.deepEqual(list.bySession.cells.get(1), [2, 0]);
});

test('hors concours teams are listed apart with their own points', () => {
  const sessions = [session(1, [heat(1, [5], [race(1, true, [{ id: 1, teamId: 5, teamName: 'Team 5', placing: 1, eliminated: false, points: 4 }])])])];
  const list = buildToplist([standing(1, 3)], sessions, [team(1), team(5, { isHorsConcours: true }), team(6, { isHorsConcours: true, competitionSectionId: 10 })], 9, null);
  assert.deepEqual(list.hc, [{ teamId: 5, teamName: 'Team 5', points: 4, racesLeft: 0 }]);
});

test('finals points get their own column so the session columns add up to the total', () => {
  const heats = session(1, [heat(1, [1], [race(1, true, [{ id: 1, teamId: 1, teamName: 'Team 1', placing: 1, eliminated: false, points: 3 }])])], { status: 2 });
  const finals = session(2, [heat(2, [1], [race(2, true, [{ id: 2, teamId: 1, teamName: 'Team 1', placing: 1, eliminated: false, points: 2 }])])], { name: 'Seniors finals' });
  const list = buildToplist([standing(1, 5)], [heats, finals], [], 9, null);
  assert.deepEqual(list.bySession.sessions.map((s) => s.label), ['S1', 'F']);
  assert.deepEqual(list.bySession.cells.get(1), [3, 2]);
});

test('a final with results becomes a group ordered by points, with the qualifying position of each team', () => {
  const qualifier = session(1, [heat(1, [1, 2], [race(1, true, [{ id: 1, teamId: 1, teamName: 'Team 1', placing: 1, eliminated: false, points: 3 }, { id: 2, teamId: 2, teamName: 'Team 2', placing: 2, eliminated: false, points: 2 }])], { label: 'Heat 1' })], { status: 2 });
  const finals = session(2, [heat(2, [1, 2], [race(2, true, [{ id: 3, teamId: 1, teamName: 'Team 1', placing: 2, eliminated: false, points: 4 }, { id: 4, teamId: 2, teamName: 'Team 2', placing: 1, eliminated: false, points: 6 }])], { label: 'A Final', raceRoundStage: 2 })], { name: 'Seniors finals' });
  const list = buildToplist([standing(1, 7), standing(2, 8)], [qualifier, finals], [], 9, null);
  assert.deepEqual(list.finals.map((g) => g.label), ['A Final']);
  assert.deepEqual(list.finals[0].rows.map((r) => [r.teamId, r.place, r.points, r.qualifyingPosition]), [[2, 1, 6, 2], [1, 2, 4, 1]]);
  assert.deepEqual(list.detail.get(2).blocks.map((b) => [b.kind, b.points]), [['final', 6], ['session', 2]]);
});
