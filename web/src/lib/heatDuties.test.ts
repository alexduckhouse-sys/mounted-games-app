import { beforeEach, describe, expect, it } from 'vitest';
import { heat, session, team } from '../test/factories';
import type { ProposedHeatDuty, VolunteerShift } from '../types';
import {
  addableSpecs, addHeatSlot, allSlots, applySetup, autoFillRoles, buildSavePayload, clearDraft, copyRoles, customSpec, defaultSetup, draftKey, dutiesPerHeat,
  dutiesToFill, dutySessions, emptySlots, findClashes, freshenDraft, gapGroups, gridCell, gridColumns, heatCount, heatDutySummary, heatTitle, initialSlots,
  isRaceSession, loadDraft, matchesSetup, mergeProposal, newUid, pickerOptions, reconcileSlots, removeHeatSlot, ridingTeamIds, roleKind, saveDraft,
  sessionChipLabels, sessionLanes, setSlotTeam, setupFromShifts, shortHeatTitle, slotName, teamDutyCounts, teamLabel, teamLoad, templateSpecs,
  type DutySlot, type RoleSetup, type SlotState,
} from './heatDuties';

const entry = (teamId: number, laneIndex = 1) => ({ id: teamId * 100 + laneIndex, teamId, teamName: `Team ${teamId}`, laneIndex });
const shift = (id: number, extra: Partial<VolunteerShift> = {}): VolunteerShift => ({
  id, competitionId: 1, role: 'Referee', requiredCount: 1, claimedCount: 0, remainingCount: 1, isFilled: false, claims: [], heatId: 1, assignedTeamId: null, ...extra,
});
const setup = (extra: Partial<RoleSetup> = {}): RoleSetup => ({ referee: true, starter: true, scorer: true, lines: 2, changeover: 0, ring: 0, custom: [], teamsInHeat: true, ...extra });
const slot = (extra: Partial<DutySlot> = {}): DutySlot => ({ uid: newUid(), shiftId: null, teamId: null, role: 'Referee', category: 'General', lane: null, required: 1, notes: null, ...extra });

const heats = [heat(1, { orderIndex: 1, entries: [entry(1), entry(2, 2)] }), heat(2, { orderIndex: 2, entries: [entry(3), entry(4, 2)] }), heat(3, { orderIndex: 3, entries: [entry(5), entry(6, 2)] })];
const sessions = dutySessions([
  session(2, { orderIndex: 2, heats: [heat(10, { entries: [entry(1)] })] }),
  session(1, { orderIndex: 1, name: 'Morning', lanesPerHeat: 4, heats: [heats[1], heats[0], heats[2]] }),
  session(3, { kind: 1, isBreak: true, heats: [heat(30)] }),
  session(4, { orderIndex: 4, heats: [] }),
]);
const teams = [1, 2, 3, 4, 5, 6, 7].map((id) => team(id, { displayName: `Team ${String.fromCharCode(64 + id)}` }));

describe('sessions and heats', () => {
  it('lists race sessions with heats in running order and skips breaks and empty sessions', () => {
    expect(sessions.map((item) => item.session.id)).toEqual([1, 2]);
    expect(sessions[0].heats.map((h) => h.id)).toEqual([1, 2, 3]);
    expect(heatCount(sessions)).toBe(4);
    expect(isRaceSession(session(9, { isBreak: true, kind: undefined as never }))).toBe(false);
    expect(isRaceSession(session(9, { kind: undefined as never }))).toBe(true);
  });
  it('names heats and knows who rides', () => {
    expect(heatTitle({ label: ' A Final ' }, 0)).toBe('A Final');
    expect(heatTitle({}, 2)).toBe('Heat 3');
    expect(shortHeatTitle({}, 2)).toBe('H3');
    expect(shortHeatTitle({ label: 'A Final' }, 0)).toBe('A Final');
    expect([...ridingTeamIds(heats[0])]).toEqual([1, 2]);
  });
  it('finds the lanes of a session from its setting, its draw or a default', () => {
    expect(sessionLanes(session(1, { lanesPerHeat: 4 }))).toBe(4);
    expect(sessionLanes(session(1, { lanesPerHeat: 50 }))).toBe(12);
    expect(sessionLanes(session(1, { heats: [heat(1, { entries: [entry(1, 3)] })] }))).toBe(3);
    expect(sessionLanes(session(1, { heats: [heat(1, { entries: [entry(1, 30)] })] }))).toBe(12);
    expect(sessionLanes(session(1))).toBe(5);
  });
});

describe('session chip labels', () => {
  const day = (id: number, name: string, start: string | null, extra = {}) => dutySessions([session(id, { name, orderIndex: id, scheduledStart: start, heats: [heat(id * 10, extra)] })])[0];
  it('adds the short day when the event runs over more than one day', () => {
    const labels = sessionChipLabels([day(1, 'Juniors A', '2026-11-11T09:00:00'), day(2, 'Pairs', '2026-11-11T11:00:00'), day(3, 'Juniors A', '2026-11-12T09:00:00'), day(4, 'Pairs', '2026-11-12T11:00:00')]);
    expect([...labels.values()]).toEqual(['Wed · Juniors A', 'Wed · Pairs', 'Thu · Juniors A', 'Thu · Pairs']);
  });
  it('uses a heat’s own time when the session has none, and leaves a one-day event with clear names alone', () => {
    const labels = sessionChipLabels([day(1, 'Morning', null, { scheduledStart: '2026-11-11T09:00:00' }), day(2, 'Afternoon', '2026-11-11T13:00:00')]);
    expect([...labels.values()]).toEqual(['Morning', 'Afternoon']);
    expect([...sessionChipLabels([day(1, 'Open', null, { scheduledStart: '2026-11-11T09:00:00' }), day(2, 'Open', '2026-11-11T13:00:00')]).values()]).toEqual(['Wed · Open', 'Wed · Open']);
  });
  it('has nothing to add when no session has a time', () => {
    expect([...sessionChipLabels([day(1, 'Open', null), day(2, 'Open', null)]).values()]).toEqual(['Open', 'Open']);
  });
});

describe('roles', () => {
  it('defaults to referee, starter, scorer and a line steward per lane', () => {
    expect(defaultSetup(sessions)).toEqual({ referee: true, starter: true, scorer: true, lines: 4, changeover: 0, ring: 0, custom: [], teamsInHeat: true });
    expect(defaultSetup([]).lines).toBe(1);
  });
  it('turns a setup into slot specs and counts them', () => {
    const full = setup({ lines: 2, changeover: 1, ring: 2, custom: [{ id: 'a', name: ' Bar ', count: 2 }, { id: 'b', name: '  ', count: 1 }], teamsInHeat: false });
    const specs = templateSpecs(full);
    expect(specs.map(slotName)).toEqual(['Referee', 'Starter', 'Scorer', 'Line steward, lane 1', 'Line steward, lane 2', 'Changeover steward, lane 1', 'Collecting ring', 'Collecting ring', 'Bar', 'Bar', 'Arena party']);
    expect(specs.find((s) => s.role === 'Arena party')?.category).toBe('ArenaCrew');
    expect(dutiesPerHeat(setup({ referee: false, starter: false, scorer: false, lines: 0 }))).toBe(0);
    expect(dutiesPerHeat(setup())).toBe(5);
  });
  it('reads a role kind from its category or name', () => {
    expect(roleKind({ role: 'referee', category: 'General' })).toBe('referee');
    expect(roleKind({ role: 'x', category: 'ArenaCrew' })).toBe('arena');
    expect(roleKind({ role: 'x', category: 'ChangeoverSteward' })).toBe('changeover');
    expect(roleKind({ role: 'x', category: 'LineSteward' })).toBe('line');
    expect(roleKind({ role: 'Collecting Ring', category: 'General' })).toBe('ring');
    expect(roleKind({ role: 'Water', category: 'General' })).toBe('custom');
  });
  it('infers the setup from saved heat duties, or falls back to the defaults', () => {
    expect(setupFromShifts([shift(1, { heatId: null })], sessions)).toEqual(defaultSetup(sessions));
    const saved = [
      shift(1, { heatId: 1, role: 'Referee' }), shift(2, { heatId: 1, role: 'Scorer' }),
      shift(3, { heatId: 1, role: 'Line steward', dutyCategory: 'LineSteward', laneNumber: 1 }), shift(4, { heatId: 1, role: 'Line steward', dutyCategory: 'LineSteward', laneNumber: 2 }),
      shift(5, { heatId: 1, role: 'Water', dutyCategory: 'General' }), shift(6, { heatId: 2, role: 'Water' }), shift(7, { heatId: 2, role: 'Water' }),
      shift(8, { heatId: 2, role: 'Collecting ring' }), shift(9, { heatId: 2, role: 'Changeover steward', dutyCategory: 'ChangeoverSteward', laneNumber: 1 }),
    ];
    const got = setupFromShifts(saved, sessions);
    expect(got).toMatchObject({ referee: true, starter: false, scorer: true, lines: 2, changeover: 1, ring: 1, teamsInHeat: true });
    expect(got.custom).toEqual([{ id: 'c-water', name: 'Water', count: 2 }]);
    expect(setupFromShifts([shift(1, { role: 'Arena party', dutyCategory: 'ArenaCrew' })], sessions).teamsInHeat).toBe(false);
  });
});

describe('slots', () => {
  it('keeps the team and saved shift of a matching earlier slot, and drops or keeps the rest', () => {
    const earlier = [slot({ role: 'Referee', teamId: 9, shiftId: 5 }), slot({ role: 'Water', teamId: 8 })];
    const specs = templateSpecs(setup({ starter: false, scorer: false, lines: 0 }));
    const dropped = reconcileSlots(specs, earlier, false);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({ role: 'Referee', teamId: 9, shiftId: 5 });
    expect(reconcileSlots(specs, earlier, true).map((s) => s.role)).toEqual(['Referee', 'Water']);
    expect(reconcileSlots(templateSpecs(setup()), [], false)[0]).toMatchObject({ teamId: null, shiftId: null, required: 1 });
  });

  it('starts from saved duties where a heat has them, flagging a heat with extra duties', () => {
    const saved = [
      shift(1, { heatId: 1, role: 'Referee', assignedTeamId: 7, requiredCount: 0, notes: 'n' }),
      shift(2, { heatId: 1, role: 'Water', dutyCategory: '' }),
    ];
    const state = initialSlots(sessions, setup({ starter: false, scorer: false, lines: 0 }), saved);
    expect(state.slots[1].map((s) => [s.role, s.teamId, s.shiftId, s.required, s.notes])).toEqual([['Referee', 7, 1, 1, 'n'], ['Water', null, 2, 1, null]]);
    expect(state.slots[2].map((s) => s.role)).toEqual(['Referee']);
    expect(state.overridden).toEqual([1]);
  });

  it('rebuilds heats from a changed setup but leaves hand-edited heats alone', () => {
    const start = initialSlots(sessions, setup(), []);
    const picked = setSlotTeam(start, 1, start.slots[1][0].uid, 7);
    const edited = addHeatSlot(picked, 2, customSpec('Water'));
    const next = applySetup(edited, sessions, setup({ lines: 1, ring: 1 }));
    expect(next.slots[1].map(slotName)).toEqual(['Referee', 'Starter', 'Scorer', 'Line steward, lane 1', 'Collecting ring']);
    expect(next.slots[1][0].teamId).toBe(7);
    expect(next.slots[2].map((s) => s.role)).toContain('Water');
    expect(next.slots[2]).toHaveLength(6);
    expect(applySetup({ slots: { 99: [] }, overridden: [99] }, sessions, setup()).overridden).toEqual([]);
    expect(applySetup({ slots: {}, overridden: [] }, sessions, setup()).slots[1]).toHaveLength(5);
  });

  it('adds, removes and copies duties, marking the heat as its own', () => {
    const start = initialSlots(sessions, setup({ lines: 0 }), []);
    const added = addHeatSlot(start, 1, customSpec('  Water  '));
    expect(added.overridden).toEqual([1]);
    expect(added.slots[1].at(-1)).toMatchObject({ role: 'Water', category: 'General' });
    expect(addHeatSlot(added, 1, customSpec('Tea')).overridden).toEqual([1]);
    const removed = removeHeatSlot(added, 1, added.slots[1][0].uid);
    expect(removed.slots[1].map((s) => s.role)).toEqual(['Starter', 'Scorer', 'Water']);
    const teamed = setSlotTeam(setSlotTeam(added, 2, added.slots[2][0].uid, 4), 99, 'nope', 1);
    const copied = copyRoles(teamed, 1, 2);
    expect(copied.slots[2].map((s) => s.role)).toEqual(['Referee', 'Starter', 'Scorer', 'Water']);
    expect(copied.slots[2][0].teamId).toBe(4);
    expect(copyRoles({ slots: {}, overridden: [] }, 5, 6).slots[6]).toEqual([]);
    expect(removeHeatSlot({ slots: {}, overridden: [] }, 5, 'x').slots[5]).toEqual([]);
    expect(addHeatSlot({ slots: {}, overridden: [] }, 5, customSpec('Water')).slots[5]).toHaveLength(1);
    expect(addableSpecs([slot({ role: 'Line steward', category: 'LineSteward', lane: null })], setup()).find((s) => s.role === 'Line steward')?.lane).toBe(1);
  });

  it('knows whether a heat holds exactly the setup roles', () => {
    const state = initialSlots(sessions, setup(), []);
    expect(matchesSetup(state.slots[1], setup())).toBe(true);
    expect(matchesSetup(state.slots[1], setup({ lines: 3 }))).toBe(false);
    expect(matchesSetup(state.slots[1], setup({ scorer: false, lines: 3 }))).toBe(false);
  });

  it('offers the duties a heat could still take on', () => {
    const base = initialSlots(sessions, setup({ lines: 2, changeover: 1 }), []).slots[1];
    const labels = addableSpecs(base, setup({ custom: [{ id: 'a', name: 'Water', count: 1 }, { id: 'b', name: ' ', count: 1 }] })).map(slotName);
    expect(labels).toEqual(['Line steward, lane 3', 'Changeover steward, lane 2', 'Collecting ring', 'Arena party', 'Water']);
    expect(addableSpecs([], setup()).map(slotName).slice(0, 3)).toEqual(['Referee', 'Starter', 'Scorer']);
    const full = initialSlots(sessions, setup({ lines: 12, changeover: 12, teamsInHeat: false }), []).slots[1];
    expect(addableSpecs(full, setup()).map(slotName)).toEqual(['Collecting ring']);
    expect(customSpec('x'.repeat(100)).role).toHaveLength(60);
  });

  it('sends the step 1 roles to auto-fill', () => {
    expect(autoFillRoles(setup({ starter: false, scorer: false, lines: 1 }))).toEqual([
      { role: 'Referee', dutyCategory: 'General', laneNumber: null, requiredCount: 1 },
      { role: 'Line steward', dutyCategory: 'LineSteward', laneNumber: 1, requiredCount: 1 },
    ]);
  });
});

describe('counts, gaps and clashes', () => {
  it('counts duties per team and lists empty slots', () => {
    const slots = { 1: [slot({ teamId: 7 }), slot({ teamId: null })], 2: [slot({ teamId: 7 }), slot({ teamId: 6 })] };
    expect([...teamDutyCounts(slots)]).toEqual([[7, 2], [6, 1]]);
    expect(emptySlots(slots[1])).toHaveLength(1);
    expect(allSlots(slots, [2, 1, 5])).toHaveLength(4);
  });
  it('groups a heat’s empty duties by role', () => {
    const gaps = gapGroups([
      slot({ role: 'Scorer' }), slot({ role: 'Referee', teamId: 3 }),
      slot({ role: 'Line steward', category: 'LineSteward', lane: 1 }), slot({ role: 'Line steward', category: 'LineSteward', lane: 2 }),
      slot({ role: 'Collecting ring' }), slot({ role: 'Collecting ring', teamId: 2 }),
    ]);
    expect(gaps.map((g) => [g.role, g.count, g.counted])).toEqual([['Scorer', 1, false], ['Line steward', 2, true], ['Collecting ring', 1, true]]);
  });
  it('finds a team on two duties and a team on duty in a heat it rides', () => {
    const map = new Map(heats.map((h) => [h.id, h]));
    const clashes = findClashes({
      1: [slot({ role: 'Referee', teamId: 1 }), slot({ role: 'Scorer', teamId: 7 }), slot({ role: 'Starter', teamId: 7 })],
      2: [slot({ teamId: 9 })],
      99: [slot({ teamId: 1 })],
    }, map);
    expect(clashes).toEqual([
      { kind: 'riding', heatId: 1, teamId: 1, roles: ['Referee'] },
      { kind: 'double', heatId: 1, teamId: 7, roles: ['Scorer', 'Starter'] },
    ]);
    expect(findClashes({ 1: [slot()] }, map)).toEqual([]);
  });
});

describe('team picker', () => {
  const list = heats;
  const here = [slot({ uid: 'a', role: 'Referee' }), slot({ uid: 'b', role: 'Scorer', teamId: 7 })];
  const base = { teams, heats: list, heatId: 2, slots: here, slotUid: 'a', counts: new Map([[7, 4], [1, 2], [5, 1], [3, 9]]) };
  it('puts the fewest duties first, then names, and blocks riders and teams already on duty', () => {
    const options = pickerOptions(base);
    const free = options.filter((o) => !o.blocked).map((o) => o.team.displayName);
    expect(free).toEqual(['Team B', 'Team F', 'Team E', 'Team A']);
    expect(options.filter((o) => o.blocked).map((o) => [o.team.displayName, o.blocked])).toEqual([['Team C', 'riding'], ['Team D', 'riding'], ['Team G', 'onDuty']]);
    expect(options.at(-1)!.team.displayName).toBe('Team G');
  });
  it('warns, without blocking, for a team riding the heat before or after', () => {
    const options = pickerOptions(base);
    expect(options.find((o) => o.team.id === 1)).toMatchObject({ blocked: null, nearHeat: 'Heat 1', duties: 2 });
    expect(options.find((o) => o.team.id === 5)).toMatchObject({ blocked: null, nearHeat: 'Heat 3' });
    expect(options.find((o) => o.team.id === 2)!.nearHeat).toBe('Heat 1');
  });
  it('marks the current team, leaves out withdrawn teams, and copes with an unknown heat', () => {
    const current = pickerOptions({ ...base, slotUid: 'b' });
    expect(current.find((o) => o.selected)?.team.id).toBe(7);
    expect(current.find((o) => o.team.id === 7)!.blocked).toBeNull();
    expect(pickerOptions({ ...base, teams: [team(1, { isWithdrawn: true })] })).toEqual([]);
    const lost = pickerOptions({ ...base, heatId: 99 });
    expect(lost.every((o) => o.blocked !== 'riding' && o.nearHeat === null)).toBe(true);
    expect(pickerOptions({ ...base, heatId: 1 }).find((o) => o.team.id === 3)!.nearHeat).toBe('Heat 2');
  });
});

describe('auto-fill merge', () => {
  const duty = (extra: Partial<ProposedHeatDuty>): ProposedHeatDuty => ({ sessionId: 1, heatId: 1, heatLabel: 'Heat 1', role: 'Referee', dutyCategory: 'General', requiredCount: 1, assignedTeamId: null, ...extra });
  const start = (): SlotState => initialSlots(sessions, setup({ starter: false, scorer: false, lines: 1 }), []);
  it('puts proposed teams in the matching slots and counts what stays empty', () => {
    const merged = mergeProposal(start(), [duty({ assignedTeamId: 7 }), duty({ role: 'Line steward', dutyCategory: 'LineSteward', laneNumber: 1 }), duty({ heatId: 99 })], true);
    expect(merged.slots[1].map((s) => s.teamId)).toEqual([7, null]);
    expect(merged).toMatchObject({ filled: 1, stillEmpty: 1 });
  });
  it('leaves slots that already have a team when keeping existing, and replaces them otherwise', () => {
    const picked = setSlotTeam(start(), 1, start().slots[1][0].uid, 1);
    const withTeam: SlotState = { ...picked, slots: { ...picked.slots, 1: picked.slots[1].map((s, i) => (i === 0 ? { ...s, teamId: 6 } : s)) } };
    expect(mergeProposal(withTeam, [duty({ assignedTeamId: 7 })], true).slots[1][0].teamId).toBe(6);
    expect(mergeProposal(withTeam, [duty({ assignedTeamId: 7 })], false).slots[1][0].teamId).toBe(7);
    expect(mergeProposal(withTeam, [duty({ assignedTeamId: null })], false).slots[1][0].teamId).toBeNull();
    expect(mergeProposal(withTeam, [duty({ assignedTeamId: 6 })], false).filled).toBe(0);
  });
  it('never makes a clash: a team already on another duty in the heat is skipped', () => {
    const state = start();
    const taken: SlotState = { ...state, slots: { ...state.slots, 1: state.slots[1].map((s) => (s.role === 'Line steward' ? { ...s, teamId: 7 } : s)) } };
    const keep = mergeProposal(taken, [duty({ assignedTeamId: 7 })], true);
    expect(keep.slots[1][0].teamId).toBeNull();
    const replace = mergeProposal({ ...taken, slots: { ...taken.slots, 1: taken.slots[1].map((s) => ({ ...s, teamId: s.role === 'Referee' ? 5 : 7 })) } }, [duty({ assignedTeamId: 7 })], false);
    expect(replace.slots[1][0].teamId).toBeNull();
  });
  it('lets a replacing fill swap two teams between duties without a false clash', () => {
    const base = start();
    const [referee, line] = base.slots[1];
    const placed: SlotState = { ...base, slots: { ...base.slots, 1: [{ ...referee, teamId: 7 }, { ...line, teamId: 6 }] } };
    const swap = mergeProposal(placed, [duty({ role: 'Line steward', dutyCategory: 'LineSteward', laneNumber: 1, assignedTeamId: 7 }), duty({ assignedTeamId: 6 })], false);
    expect(swap.slots[1].map((s) => s.teamId)).toEqual([6, 7]);
    expect(swap.stillEmpty).toBe(0);
    // A team on a duty the proposal doesn't cover still blocks the proposal.
    const other: SlotState = { ...placed, slots: { ...placed.slots, 1: [...placed.slots[1], slot({ role: 'Water', teamId: 5 })] } };
    expect(mergeProposal(other, [duty({ assignedTeamId: 5 })], false).slots[1][0].teamId).toBeNull();
  });
  it('matches each proposal to its own slot when a role repeats, and ignores one with no slot', () => {
    const state = initialSlots(sessions, setup({ referee: false, starter: false, scorer: false, lines: 0, ring: 2 }), []);
    const ring = (team: number) => duty({ role: 'Collecting ring', assignedTeamId: team });
    const merged = mergeProposal(state, [ring(7), ring(6), ring(5)], true);
    expect(merged.slots[1].map((s) => s.teamId)).toEqual([7, 6]);
    expect(merged.filled).toBe(2);
  });
  it('counts the duties a fill will ask for', () => {
    const state = setSlotTeam(start(), 1, start().slots[1][0].uid, 1);
    const filled: SlotState = { ...state, slots: { ...state.slots, 1: state.slots[1].map((s, i) => (i === 0 ? { ...s, teamId: 7 } : s)) } };
    expect(dutiesToFill(filled.slots, [1, 2], true)).toBe(3);
    expect(dutiesToFill(filled.slots, [1, 2], false)).toBe(4);
    expect(dutiesToFill(filled.slots, [99], false)).toBe(0);
    expect(dutiesToFill(filled.slots, [99], true)).toBe(0);
  });
});

describe('saving', () => {
  it('builds the PUT body with saved ids where there are any', () => {
    const slots = { 1: [slot({ shiftId: 4, teamId: 7, notes: 'n' }), slot({ role: 'Line steward', category: 'LineSteward', lane: 2 })], 2: [slot({ teamId: null })] };
    expect(buildSavePayload(slots, [1, 2, 3], [1], false)).toEqual({
      sessionIds: [1],
      duties: [
        { id: 4, heatId: 1, role: 'Referee', dutyCategory: 'General', laneNumber: null, assignedTeamId: 7, requiredCount: 1, notes: 'n' },
        { heatId: 1, role: 'Line steward', dutyCategory: 'LineSteward', laneNumber: 2, assignedTeamId: null, requiredCount: 1, notes: null },
        { heatId: 2, role: 'Referee', dutyCategory: 'General', laneNumber: null, assignedTeamId: null, requiredCount: 1, notes: null },
      ],
    });
    expect(buildSavePayload(slots, [], [1, 2], true)).toEqual({ sessionIds: [1, 2], duties: [], confirmRemoveCheckedIn: true });
  });
  it('summarises how many heats are filled', () => {
    const shifts = [shift(1, { heatId: 1, assignedTeamId: 3 }), shift(2, { heatId: 1, assignedTeamId: 4 }), shift(3, { heatId: 2, assignedTeamId: null }), shift(4, { heatId: null, assignedTeamId: 3 })];
    expect(heatDutySummary(shifts, 36)).toEqual({ heats: 36, filled: 1, started: true });
    expect(heatDutySummary([shift(1, { heatId: null })], 4)).toEqual({ heats: 4, filled: 0, started: false });
  });
});

describe('the check grid', () => {
  const state = initialSlots(sessions, setup({ lines: 2, ring: 0, custom: [{ id: 'a', name: 'Water', count: 1 }] }), []);
  const filled: SlotState = { ...state, slots: { ...state.slots, 1: state.slots[1].map((s) => (s.role === 'Referee' ? { ...s, teamId: 7 } : s.lane === 1 ? { ...s, teamId: 6 } : s)), 2: state.slots[2].filter((s) => s.role !== 'Starter') } };
  it('has one column per kind of duty, in a fixed order', () => {
    const order = [1, 2, 3, 10];
    const columns = gridColumns(filled.slots, order);
    expect(columns.map((c) => c.id)).toEqual(['referee', 'starter', 'scorer', 'line', 'custom:water']);
    expect(columns.map((c) => c.multi)).toEqual([false, false, false, true, false]);
    expect(columns[4]).toMatchObject({ kind: 'custom', name: 'Water' });
    expect(gridColumns(filled.slots, [])).toEqual([]);
    expect(gridColumns(filled.slots, [99, 1]).map((c) => c.id)).toEqual(columns.map((c) => c.id));
  });
  it('reads a cell as a team, a count or nothing', () => {
    const columns = gridColumns(filled.slots, [1, 2]);
    const [referee, starter, , lines] = columns;
    expect(gridCell(filled.slots[1], referee)).toEqual({ kind: 'one', teamId: 7 });
    expect(gridCell(filled.slots[1], starter)).toEqual({ kind: 'one', teamId: null });
    expect(gridCell(filled.slots[2], starter)).toEqual({ kind: 'none' });
    expect(gridCell(filled.slots[1], lines)).toEqual({ kind: 'many', filled: 1, total: 2 });
  });
  it('ranks teams by duties and gives the lowest and highest', () => {
    const load = teamLoad([...teams, team(8, { isWithdrawn: true })], new Map([[2, 3], [1, 3], [4, 1]]));
    expect(load.rows.map((r) => [r.team.id, r.count]).slice(0, 4)).toEqual([[1, 3], [2, 3], [4, 1], [3, 0]]);
    expect(load).toMatchObject({ fewest: 0, most: 3 });
    expect(teamLoad([], new Map())).toEqual({ rows: [], fewest: 0, most: 0 });
    expect(teamLabel(team(1, { displayName: 'Meriden A', sectionName: 'Teams Seniors' }))).toContain('Meriden A');
  });
});

describe('the draft', () => {
  const state = initialSlots(sessions, setup(), []);
  const draft = { v: 1 as const, step: 1 as const, setup: setup(), slots: state.slots, overridden: [1] };
  beforeEach(() => localStorage.clear());
  it('round-trips through storage and clears', () => {
    saveDraft(5, draft);
    expect(loadDraft(5)).toEqual(draft);
    clearDraft(5);
    expect(loadDraft(5)).toBeNull();
  });
  it('ignores anything it can’t read', () => {
    const put = (value: unknown) => localStorage.setItem(draftKey(5), typeof value === 'string' ? value : JSON.stringify(value));
    expect(loadDraft(5)).toBeNull();
    put('not json'); expect(loadDraft(5)).toBeNull();
    put({ ...draft, v: 2 }); expect(loadDraft(5)).toBeNull();
    put({ ...draft, step: 7 }); expect(loadDraft(5)).toBeNull();
    put({ ...draft, setup: { referee: 1 } }); expect(loadDraft(5)).toBeNull();
    put({ ...draft, setup: { ...setup(), custom: [{ id: 1 }] } }); expect(loadDraft(5)).toBeNull();
    put({ ...draft, slots: { 1: 'x' } }); expect(loadDraft(5)).toBeNull();
    put({ ...draft, slots: { 1: [{ uid: 'a' }] } }); expect(loadDraft(5)).toBeNull();
    put({ ...draft, slots: [] }); expect(loadDraft(5)).toBeNull();
    const [first] = Object.values(draft.slots);
    for (const bad of [{ uid: 1 }, { role: 1 }, { category: 1 }, { lane: 'x' }, { teamId: 'x' }, { shiftId: 'x' }, { required: 'x' }]) {
      put({ ...draft, slots: { 1: [{ ...first[0], ...bad }] } }); expect(loadDraft(5)).toBeNull();
    }
    for (const bad of [{ referee: 1 }, { starter: 1 }, { scorer: 1 }, { lines: 'x' }, { changeover: 'x' }, { ring: 'x' }, { teamsInHeat: 1 }, { custom: 'x' }, { custom: [{ id: 'a', name: 1, count: 1 }] }, { custom: [{ id: 'a', name: 'b', count: 'x' }] }]) {
      put({ ...draft, setup: { ...setup(), ...bad } }); expect(loadDraft(5)).toBeNull();
    }
    put({ ...draft, overridden: 'x' }); expect(loadDraft(5)).toBeNull();
    put({ ...draft, overridden: [1, 'x'] }); expect(loadDraft(5)?.overridden).toEqual([1]);
  });
  it('never throws when storage is unavailable', () => {
    const original = Storage.prototype.setItem;
    const getter = Storage.prototype.getItem;
    const remover = Storage.prototype.removeItem;
    const boom = () => { throw new Error('blocked'); };
    Storage.prototype.setItem = boom; Storage.prototype.getItem = boom; Storage.prototype.removeItem = boom;
    try {
      expect(() => saveDraft(5, draft)).not.toThrow();
      expect(loadDraft(5)).toBeNull();
      expect(() => clearDraft(5)).not.toThrow();
    } finally { Storage.prototype.setItem = original; Storage.prototype.getItem = getter; Storage.prototype.removeItem = remover; }
  });
  it('brings an old draft up to date with the event', () => {
    const old = { ...draft, slots: { 1: state.slots[1], 77: [slot()] }, overridden: [1, 77] };
    const fresh = freshenDraft(old, sessions);
    expect(Object.keys(fresh.slots).sort()).toEqual(['1', '10', '2', '3']);
    expect(fresh.slots[2]).toHaveLength(5);
    expect(fresh.overridden).toEqual([1]);
  });
});
