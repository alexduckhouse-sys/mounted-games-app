import type { Heat, HeatDutyRoleTemplateInput, ProposedHeatDuty, SaveHeatDutiesInput, Session, Team, VolunteerShift } from '../types';
import { tr } from '../i18n/translate';
import { displaySectionName } from './section';

/**
 * The pure logic behind the Heat duties wizard: the roles every heat needs, the duty slots they turn into, who may be
 * picked for a slot, gaps and clashes, the merge of an auto-fill proposal and the body saved to the API. The pages only
 * draw what this works out.
 */

export type DutyKind = 'referee' | 'starter' | 'scorer' | 'line' | 'changeover' | 'ring' | 'arena' | 'custom';

/** The role names the API stores. They stay in English: they are data the whole event shares, and `roleKind` reads them back. */
export const ROLE_NAME = {
  referee: 'Referee',
  starter: 'Starter',
  scorer: 'Scorer',
  line: 'Line steward',
  changeover: 'Changeover steward',
  ring: 'Collecting ring',
  arena: 'Arena party',
} as const;

const CATEGORY = { general: 'General', line: 'LineSteward', changeover: 'ChangeoverSteward', arena: 'ArenaCrew' } as const;

export interface CustomRole { id: string; name: string; count: number }

/** Step 1: what every heat needs. A count of 0 (or a switch off) means the role isn't used. */
export interface RoleSetup {
  referee: boolean;
  starter: boolean;
  scorer: boolean;
  lines: number;
  changeover: number;
  ring: number;
  custom: CustomRole[];
  /** On: the arena party is the teams riding the heat, so no duty is made. Off: one ArenaCrew duty a heat. */
  teamsInHeat: boolean;
}

/** What a slot is, before it has a team. */
export interface SlotSpec { role: string; category: string; lane: number | null }

/** One duty in one heat, as the wizard holds it until it is saved. */
export interface DutySlot extends SlotSpec {
  uid: string;
  /** The saved shift this slot is, so saving again updates it instead of adding another. */
  shiftId: number | null;
  teamId: number | null;
  required: number;
  notes: string | null;
}

export type SlotsByHeat = Record<number, DutySlot[]>;

export const MAX_LINES = 12;
export const MAX_ROLE_COUNT = 12;
export const MAX_CUSTOM_ROLES = 8;
export const MAX_ROLE_NAME = 60;

let uidCounter = 0;
export function newUid(): string {
  uidCounter += 1;
  return `d${Date.now().toString(36)}${uidCounter}`;
}

// ---- sessions and heats ----

export const isRaceSession = (session: Session): boolean => (session.kind ?? (session.isBreak ? 1 : 0)) === 0;

export interface DutySession { session: Session; heats: Heat[] }

/** The sessions that can have heat duties, in running order, each with its heats in order. Breaks and sessions with no heats are left out. */
export function dutySessions(sessions: readonly Session[]): DutySession[] {
  return [...sessions]
    .filter((session) => isRaceSession(session) && session.heats.length > 0)
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((session) => ({ session, heats: [...session.heats].sort((a, b) => a.orderIndex - b.orderIndex) }));
}

/** "Heat 3", or the label the organiser gave the heat. `index` counts from 0 within its session. */
export function heatTitle(heat: Pick<Heat, 'label'>, index: number): string {
  return heat.label?.trim() || tr('teams.team.heatN', { number: index + 1 });
}

export const heatCount = (list: readonly DutySession[]): number => list.reduce((sum, item) => sum + item.heats.length, 0);

/** How many lanes a session has: its setting, else the busiest lane drawn, else five. */
export function sessionLanes(session: Session): number {
  if (session.lanesPerHeat && session.lanesPerHeat > 0) return Math.min(MAX_LINES, session.lanesPerHeat);
  const drawn = Math.max(0, ...session.heats.flatMap((heat) => heat.entries.map((entry) => entry.laneIndex)));
  return drawn > 0 ? Math.min(MAX_LINES, drawn) : 5;
}

export const ridingTeamIds = (heat: Pick<Heat, 'entries'>): Set<number> => new Set(heat.entries.map((entry) => entry.teamId));

// ---- roles ----

export function defaultSetup(sessions: readonly DutySession[]): RoleSetup {
  const lanes = Math.max(1, ...sessions.map((item) => sessionLanes(item.session)));
  return { referee: true, starter: true, scorer: true, lines: lanes, changeover: 0, ring: 0, custom: [], teamsInHeat: true };
}

export function roleKind(slot: Pick<SlotSpec, 'role' | 'category'>): DutyKind {
  const name = slot.role.trim().toLowerCase();
  if (slot.category === CATEGORY.arena) return 'arena';
  if (slot.category === CATEGORY.changeover) return 'changeover';
  if (slot.category === CATEGORY.line) return 'line';
  for (const kind of ['referee', 'starter', 'scorer', 'line', 'changeover', 'ring', 'arena'] as const) {
    if (name === ROLE_NAME[kind].toLowerCase()) return kind;
  }
  return 'custom';
}

/** The duty slots one heat gets from the setup, in the order the wizard lists them. */
export function templateSpecs(setup: RoleSetup): SlotSpec[] {
  const specs: SlotSpec[] = [];
  const general = (role: string): SlotSpec => ({ role, category: CATEGORY.general, lane: null });
  if (setup.referee) specs.push(general(ROLE_NAME.referee));
  if (setup.starter) specs.push(general(ROLE_NAME.starter));
  if (setup.scorer) specs.push(general(ROLE_NAME.scorer));
  for (let lane = 1; lane <= setup.lines; lane += 1) specs.push({ role: ROLE_NAME.line, category: CATEGORY.line, lane });
  for (let lane = 1; lane <= setup.changeover; lane += 1) specs.push({ role: ROLE_NAME.changeover, category: CATEGORY.changeover, lane });
  for (let n = 0; n < setup.ring; n += 1) specs.push(general(ROLE_NAME.ring));
  for (const role of setup.custom) {
    const name = role.name.trim();
    if (name) for (let n = 0; n < role.count; n += 1) specs.push(general(name));
  }
  if (!setup.teamsInHeat) specs.push({ role: ROLE_NAME.arena, category: CATEGORY.arena, lane: null });
  return specs;
}

export const dutiesPerHeat = (setup: RoleSetup): number => templateSpecs(setup).length;

const categoryOf = (shift: Pick<VolunteerShift, 'dutyCategory'>): string => shift.dutyCategory?.trim() || CATEGORY.general;

/** Heat-level duties only: the rota's whole-event and session shifts aren't part of the wizard. */
export const heatShifts = (shifts: readonly VolunteerShift[]): VolunteerShift[] => shifts.filter((shift) => shift.heatId != null);

function slotFromShift(shift: VolunteerShift): DutySlot {
  return {
    uid: newUid(), shiftId: shift.id, teamId: shift.assignedTeamId ?? null, role: shift.role, category: categoryOf(shift),
    lane: shift.laneNumber ?? null, required: Math.max(1, shift.requiredCount || 1), notes: shift.notes ?? null,
  };
}

/** The roles the heat duties already saved imply, or the defaults when there are none. */
export function setupFromShifts(shifts: readonly VolunteerShift[], sessions: readonly DutySession[]): RoleSetup {
  const base = defaultSetup(sessions);
  const saved = heatShifts(shifts);
  if (saved.length === 0) return base;
  const byHeat = new Map<number, DutySlot[]>();
  for (const shift of saved) byHeat.set(shift.heatId!, [...(byHeat.get(shift.heatId!) ?? []), slotFromShift(shift)]);
  const most = (kind: DutyKind) => Math.max(0, ...[...byHeat.values()].map((slots) => slots.filter((slot) => roleKind(slot) === kind).length));
  const custom = new Map<string, CustomRole>();
  for (const slots of byHeat.values()) {
    const counts = new Map<string, { name: string; count: number }>();
    for (const slot of slots.filter((s) => roleKind(s) === 'custom')) {
      const key = slot.role.trim().toLowerCase();
      counts.set(key, { name: slot.role.trim(), count: (counts.get(key)?.count ?? 0) + 1 });
    }
    for (const [key, item] of counts) {
      const seen = custom.get(key);
      custom.set(key, { id: seen?.id ?? `c-${key}`, name: seen?.name ?? item.name, count: Math.max(seen?.count ?? 0, Math.min(MAX_ROLE_COUNT, item.count)) });
    }
  }
  return {
    referee: most('referee') > 0, starter: most('starter') > 0, scorer: most('scorer') > 0,
    lines: Math.min(MAX_LINES, most('line')), changeover: Math.min(MAX_LINES, most('changeover')), ring: Math.min(MAX_ROLE_COUNT, most('ring')),
    custom: [...custom.values()].slice(0, MAX_CUSTOM_ROLES), teamsInHeat: most('arena') === 0,
  };
}

// ---- slots ----

const matchKey = (spec: SlotSpec): string => `${spec.role.trim().toLowerCase()}|${spec.lane ?? ''}`;

/**
 * Turns role specs into slots, carrying over the team (and saved shift) of any earlier slot with the same role and lane.
 * Earlier slots with no match are dropped, or kept at the end when `keepExtras` is set (a heat with its own extra duty).
 */
export function reconcileSlots(specs: readonly SlotSpec[], previous: readonly DutySlot[], keepExtras: boolean): DutySlot[] {
  const pool = [...previous];
  const slots = specs.map((spec): DutySlot => {
    const at = pool.findIndex((slot) => matchKey(slot) === matchKey(spec));
    if (at < 0) return { ...spec, uid: newUid(), shiftId: null, teamId: null, required: 1, notes: null };
    const [found] = pool.splice(at, 1);
    return { ...found, ...spec };
  });
  return keepExtras ? [...slots, ...pool] : slots;
}

export interface SlotState { slots: SlotsByHeat; overridden: number[] }

/** The wizard's starting slots: the saved heat duties where a heat has any, otherwise the setup's roles. */
export function initialSlots(sessions: readonly DutySession[], setup: RoleSetup, shifts: readonly VolunteerShift[]): SlotState {
  const specs = templateSpecs(setup);
  const saved = heatShifts(shifts);
  const slots: SlotsByHeat = {};
  const overridden: number[] = [];
  for (const { heats } of sessions) {
    for (const heat of heats) {
      const previous = saved.filter((shift) => shift.heatId === heat.id).map(slotFromShift);
      const built = reconcileSlots(specs, previous, true);
      if (built.length > specs.length) overridden.push(heat.id);
      slots[heat.id] = built;
    }
  }
  return { slots, overridden };
}

/** Step 1 changed: rebuild every heat that hasn't been changed by hand, keeping the teams already picked. */
export function applySetup(state: SlotState, sessions: readonly DutySession[], setup: RoleSetup): SlotState {
  const specs = templateSpecs(setup);
  const own = new Set(state.overridden);
  const slots: SlotsByHeat = {};
  for (const { heats } of sessions) {
    for (const heat of heats) {
      const previous = state.slots[heat.id] ?? [];
      slots[heat.id] = own.has(heat.id) ? previous : reconcileSlots(specs, previous, false);
    }
  }
  return { slots, overridden: state.overridden.filter((id) => id in slots) };
}

const withHeat = (state: SlotState, heatId: number, next: DutySlot[]): SlotState => ({
  slots: { ...state.slots, [heatId]: next },
  overridden: state.overridden.includes(heatId) ? state.overridden : [...state.overridden, heatId],
});

export function setSlotTeam(state: SlotState, heatId: number, uid: string, teamId: number | null): SlotState {
  return { ...state, slots: { ...state.slots, [heatId]: (state.slots[heatId] ?? []).map((slot) => (slot.uid === uid ? { ...slot, teamId } : slot)) } };
}

/** A heat gets a duty the other heats don't have. */
export function addHeatSlot(state: SlotState, heatId: number, spec: SlotSpec): SlotState {
  return withHeat(state, heatId, [...(state.slots[heatId] ?? []), { ...spec, uid: newUid(), shiftId: null, teamId: null, required: 1, notes: null }]);
}

/** A heat drops a duty. Saving removes the saved shift it was. */
export function removeHeatSlot(state: SlotState, heatId: number, uid: string): SlotState {
  return withHeat(state, heatId, (state.slots[heatId] ?? []).filter((slot) => slot.uid !== uid));
}

/** "Same roles as Heat N": the heat gets the other heat's duties, keeping the teams it already has for matching ones. */
export function copyRoles(state: SlotState, fromHeatId: number, toHeatId: number): SlotState {
  const specs = (state.slots[fromHeatId] ?? []).map(({ role, category, lane }): SlotSpec => ({ role, category, lane }));
  return withHeat(state, toHeatId, reconcileSlots(specs, state.slots[toHeatId] ?? [], false));
}

/** Does this heat hold exactly the duties the setup gives every heat? */
export function matchesSetup(slots: readonly DutySlot[], setup: RoleSetup): boolean {
  const want = templateSpecs(setup).map(matchKey).sort();
  const have = slots.map(matchKey).sort();
  return want.length === have.length && want.every((key, index) => key === have[index]);
}

/** The duties a heat could still take on: roles it lacks, or one more of those that can repeat (the next lane, another collecting ring). */
export function addableSpecs(slots: readonly DutySlot[], setup: RoleSetup): SlotSpec[] {
  const has = (kind: DutyKind) => slots.some((slot) => roleKind(slot) === kind);
  const nextLane = (kind: DutyKind) => Math.max(0, ...slots.filter((slot) => roleKind(slot) === kind).map((slot) => slot.lane ?? 0)) + 1;
  const specs: SlotSpec[] = [];
  const general = (role: string): SlotSpec => ({ role, category: CATEGORY.general, lane: null });
  if (!has('referee')) specs.push(general(ROLE_NAME.referee));
  if (!has('starter')) specs.push(general(ROLE_NAME.starter));
  if (!has('scorer')) specs.push(general(ROLE_NAME.scorer));
  if (nextLane('line') <= MAX_LINES) specs.push({ role: ROLE_NAME.line, category: CATEGORY.line, lane: nextLane('line') });
  if (nextLane('changeover') <= MAX_LINES) specs.push({ role: ROLE_NAME.changeover, category: CATEGORY.changeover, lane: nextLane('changeover') });
  specs.push(general(ROLE_NAME.ring));
  if (!has('arena')) specs.push({ role: ROLE_NAME.arena, category: CATEGORY.arena, lane: null });
  for (const role of setup.custom) if (role.name.trim()) specs.push(general(role.name.trim()));
  return specs;
}

/** A duty added by name, for a job that isn't in the list. */
export const customSpec = (name: string): SlotSpec => ({ role: name.trim().slice(0, MAX_ROLE_NAME), category: CATEGORY.general, lane: null });

/** The roles sent to auto-fill: what step 1 gives every heat. */
export const autoFillRoles = (setup: RoleSetup): HeatDutyRoleTemplateInput[] =>
  templateSpecs(setup).map((spec) => ({ role: spec.role, dutyCategory: spec.category, laneNumber: spec.lane, requiredCount: 1 }));

/** "H3" for a heat called "Heat 3" (or "Manche 3"), else the label as given. */
export function shortHeatTitle(heat: Pick<Heat, 'label'>, index: number): string {
  const title = heatTitle(heat, index);
  const match = /^\p{L}+\s*(\d+)$/u.exec(title);
  return match ? `H${match[1]}` : title;
}

// ---- counts, gaps and clashes ----

export const allSlots = (slots: SlotsByHeat, order: readonly number[]): DutySlot[] => order.flatMap((heatId) => slots[heatId] ?? []);

/** How many duties each team has, across the whole event. */
export function teamDutyCounts(slots: SlotsByHeat): Map<number, number> {
  const counts = new Map<number, number>();
  for (const list of Object.values(slots)) for (const slot of list) if (slot.teamId != null) counts.set(slot.teamId, (counts.get(slot.teamId) ?? 0) + 1);
  return counts;
}

export const emptySlots = (slots: readonly DutySlot[]): DutySlot[] => slots.filter((slot) => slot.teamId == null);

export interface GapGroup { role: string; category: string; count: number; /** The duty has a lane or the role is used more than once, so it reads "2 line steward". */ counted: boolean }

/** The empty duties of one heat, one entry per role: "Scorer", "1 line steward". */
export function gapGroups(slots: readonly DutySlot[]): GapGroup[] {
  const groups = new Map<string, GapGroup>();
  for (const slot of emptySlots(slots)) {
    const key = `${roleKind(slot)}|${slot.role.trim().toLowerCase()}`;
    const group = groups.get(key) ?? { role: slot.role, category: slot.category, count: 0, counted: false };
    group.count += 1;
    group.counted = group.counted || slot.lane != null || slots.filter((s) => s.role === slot.role).length > 1;
    groups.set(key, group);
  }
  return [...groups.values()];
}

export interface DutyClash {
  kind: 'double' | 'riding';
  heatId: number;
  teamId: number;
  /** The heat's duties involved, for the red line in the check. */
  roles: string[];
}

/** A team on two duties in one heat, or on a duty in a heat it rides. The wizard doesn't let either happen, but saved data might. */
export function findClashes(slots: SlotsByHeat, heats: ReadonlyMap<number, Heat>): DutyClash[] {
  const clashes: DutyClash[] = [];
  for (const [key, list] of Object.entries(slots)) {
    const heatId = Number(key);
    const riding = heats.get(heatId) ? ridingTeamIds(heats.get(heatId)!) : new Set<number>();
    const byTeam = new Map<number, DutySlot[]>();
    for (const slot of list) if (slot.teamId != null) byTeam.set(slot.teamId, [...(byTeam.get(slot.teamId) ?? []), slot]);
    for (const [teamId, mine] of byTeam) {
      const roles = mine.map(slotName);
      if (mine.length > 1) clashes.push({ kind: 'double', heatId, teamId, roles });
      if (riding.has(teamId)) clashes.push({ kind: 'riding', heatId, teamId, roles });
    }
  }
  return clashes;
}

/** "Line steward, lane 2" in English, used where a plain name is enough (clash lists and tests). */
export const slotName = (slot: Pick<SlotSpec, 'role' | 'lane'>): string => (slot.lane != null ? `${slot.role}, lane ${slot.lane}` : slot.role);

// ---- the team picker ----

export interface PickerOption {
  team: Team;
  duties: number;
  selected: boolean;
  /** Why the team can't be picked. */
  blocked: 'riding' | 'onDuty' | null;
  /** The heat before or after this one that the team rides in: a warning, not a block. */
  nearHeat: string | null;
}

/**
 * Every team that might do a duty, fewest duties first (then by name), with those who can't be picked at the end. A team
 * riding the heat, or already on another duty in it, is blocked; one riding the heat just before or after only gets a warning.
 */
export function pickerOptions(args: {
  teams: readonly Team[];
  heats: readonly Heat[];
  heatId: number;
  slots: readonly DutySlot[];
  slotUid: string;
  counts: ReadonlyMap<number, number>;
}): PickerOption[] {
  const { teams, heats, heatId, slots, slotUid, counts } = args;
  const at = heats.findIndex((heat) => heat.id === heatId);
  const riding = at >= 0 ? ridingTeamIds(heats[at]) : new Set<number>();
  const onDuty = new Set(slots.filter((slot) => slot.uid !== slotUid && slot.teamId != null).map((slot) => slot.teamId!));
  const current = slots.find((slot) => slot.uid === slotUid)?.teamId ?? null;
  const near = (offset: number): [Set<number>, string | null] => {
    const heat = heats[at + offset];
    return at >= 0 && heat ? [ridingTeamIds(heat), heatTitle(heat, at + offset)] : [new Set<number>(), null];
  };
  const [before, beforeName] = near(-1);
  const [after, afterName] = near(1);
  const options = teams.filter((team) => !team.isWithdrawn).map((team): PickerOption => ({
    team,
    duties: counts.get(team.id) ?? 0,
    selected: team.id === current,
    blocked: riding.has(team.id) ? 'riding' : onDuty.has(team.id) ? 'onDuty' : null,
    nearHeat: before.has(team.id) ? beforeName : after.has(team.id) ? afterName : null,
  }));
  const byName = (a: PickerOption, b: PickerOption) => a.team.displayName.localeCompare(b.team.displayName, 'en-GB');
  const open = options.filter((option) => !option.blocked).sort((a, b) => a.duties - b.duties || byName(a, b));
  const blocked = options.filter((option) => option.blocked).sort(byName);
  return [...open, ...blocked];
}

// ---- auto-fill ----

export interface MergeResult extends SlotState { filled: number; stillEmpty: number }

/**
 * Puts an auto-fill proposal into the wizard's slots. Proposal items find their slot by heat, role and lane. With
 * `keepExisting` a slot that already has a team is left alone. A proposed team that the wizard already has on another
 * duty in that heat is skipped, so the proposal can never create a clash. Slots the proposal doesn't mention are untouched.
 */
export function mergeProposal(state: SlotState, proposal: readonly ProposedHeatDuty[], keepExisting: boolean): MergeResult {
  const slots: SlotsByHeat = Object.fromEntries(Object.entries(state.slots).map(([key, list]) => [key, list.map((slot) => ({ ...slot }))]));
  const touched = new Set<number>();
  const claimed = new Set<string>();
  let filled = 0;
  for (const item of proposal) {
    const list = slots[item.heatId];
    if (!list) continue;
    touched.add(item.heatId);
    const spec: SlotSpec = { role: item.role, category: item.dutyCategory, lane: item.laneNumber ?? null };
    const slot = list.find((candidate) => !claimed.has(candidate.uid) && matchKey(candidate) === matchKey(spec));
    if (!slot) continue;
    claimed.add(slot.uid);
    if (keepExisting && slot.teamId != null) continue;
    const team = item.assignedTeamId ?? null;
    if (team != null && list.some((other) => other.uid !== slot.uid && other.teamId === team)) { if (!keepExisting) slot.teamId = null; continue; }
    if (team != null && slot.teamId !== team) filled += 1;
    slot.teamId = team;
  }
  const stillEmpty = [...touched].reduce((sum, heatId) => sum + emptySlots(slots[heatId]).length, 0);
  return { slots, overridden: state.overridden, filled, stillEmpty };
}

/** How many duties "Fill N duties" will ask for: the non-break heats' empty duties, or all of them when existing picks may change. */
export function dutiesToFill(slots: SlotsByHeat, heatIds: readonly number[], keepExisting: boolean): number {
  return heatIds.reduce((sum, id) => sum + (keepExisting ? emptySlots(slots[id] ?? []).length : (slots[id] ?? []).length), 0);
}

// ---- saving ----

/** The body for `PUT heat-duties`: every duty of every heat the wizard covers, with the saved shift id where there is one. */
export function buildSavePayload(slots: SlotsByHeat, order: readonly number[], sessionIds: readonly number[], confirmRemoveCheckedIn = false): SaveHeatDutiesInput {
  return {
    sessionIds: [...sessionIds],
    duties: order.flatMap((heatId) => (slots[heatId] ?? []).map((slot) => ({
      ...(slot.shiftId != null ? { id: slot.shiftId } : {}),
      heatId,
      role: slot.role,
      dutyCategory: slot.category,
      laneNumber: slot.lane,
      assignedTeamId: slot.teamId,
      requiredCount: slot.required,
      notes: slot.notes,
    }))),
    ...(confirmRemoveCheckedIn ? { confirmRemoveCheckedIn: true } : {}),
  };
}

/** How many heats have every duty filled, out of all the event's heats. */
export function heatDutySummary(shifts: readonly VolunteerShift[], totalHeats: number): { heats: number; filled: number; started: boolean } {
  const byHeat = new Map<number, VolunteerShift[]>();
  for (const shift of heatShifts(shifts)) byHeat.set(shift.heatId!, [...(byHeat.get(shift.heatId!) ?? []), shift]);
  const filled = [...byHeat.values()].filter((list) => list.every((shift) => shift.assignedTeamId != null)).length;
  return { heats: totalHeats, filled, started: byHeat.size > 0 };
}

// ---- the check grid ----

export interface GridColumn {
  /** `referee`, `starter`, `scorer`, `line`, `changeover`, `ring`, `arena`, or `custom:<lower-case name>`. */
  id: string;
  kind: DutyKind;
  /** The role's own name, used for a custom role's heading. */
  name: string;
  /** Some heat has more than one duty in it, so cells read "4 of 5" rather than a team name. */
  multi: boolean;
}

const KIND_ORDER: DutyKind[] = ['referee', 'starter', 'scorer', 'line', 'changeover', 'ring', 'arena', 'custom'];
const columnId = (slot: SlotSpec): string => { const kind = roleKind(slot); return kind === 'custom' ? `custom:${slot.role.trim().toLowerCase()}` : kind; };

/** One column for each kind of duty used anywhere: Ref, Start, Score, Lines, then the rest. */
export function gridColumns(slots: SlotsByHeat, order: readonly number[]): GridColumn[] {
  const columns = new Map<string, GridColumn>();
  for (const heatId of order) {
    const list = slots[heatId] ?? [];
    for (const slot of list) {
      const id = columnId(slot);
      const inHeat = list.filter((other) => columnId(other) === id).length;
      const seen = columns.get(id);
      columns.set(id, { id, kind: roleKind(slot), name: seen?.name ?? slot.role.trim(), multi: (seen?.multi ?? false) || inHeat > 1 });
    }
  }
  const rank = (column: GridColumn) => KIND_ORDER.indexOf(column.kind);
  return [...columns.values()].sort((a, b) => rank(a) - rank(b));
}

export type GridCell = { kind: 'none' } | { kind: 'one'; teamId: number | null } | { kind: 'many'; filled: number; total: number };

export function gridCell(slots: readonly DutySlot[], column: GridColumn): GridCell {
  const mine = slots.filter((slot) => columnId(slot) === column.id);
  if (mine.length === 0) return { kind: 'none' };
  if (!column.multi) return { kind: 'one', teamId: mine[0].teamId };
  return { kind: 'many', filled: mine.filter((slot) => slot.teamId != null).length, total: mine.length };
}

/** Every team with its duty count, most first, and the lowest and highest counts across them. */
export function teamLoad(teams: readonly Team[], counts: ReadonlyMap<number, number>): { rows: { team: Team; count: number }[]; fewest: number; most: number } {
  const rows = teams.filter((team) => !team.isWithdrawn)
    .map((team) => ({ team, count: counts.get(team.id) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.team.displayName.localeCompare(b.team.displayName, 'en-GB'));
  return { rows, fewest: rows.length ? Math.min(...rows.map((row) => row.count)) : 0, most: rows.length ? Math.max(...rows.map((row) => row.count)) : 0 };
}

/** The age group and team name, e.g. for a team in a pairs section. */
export const teamLabel = (team: Pick<Team, 'displayName' | 'sectionName'>): string => `${team.displayName} · ${displaySectionName(team.sectionName)}`;

// ---- the draft ----

export interface DutyDraft { v: 1; step: 0 | 1 | 2; setup: RoleSetup; slots: SlotsByHeat; overridden: number[] }

export const draftKey = (competitionId: number): string => `mg.draft.heatDuties.${competitionId}`;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function isSlot(value: unknown): value is DutySlot {
  return isRecord(value) && typeof value.uid === 'string' && typeof value.role === 'string' && typeof value.category === 'string'
    && (value.lane === null || typeof value.lane === 'number') && (value.teamId === null || typeof value.teamId === 'number')
    && (value.shiftId === null || typeof value.shiftId === 'number') && typeof value.required === 'number';
}

function isSetup(value: unknown): value is RoleSetup {
  return isRecord(value) && typeof value.referee === 'boolean' && typeof value.starter === 'boolean' && typeof value.scorer === 'boolean'
    && typeof value.lines === 'number' && typeof value.changeover === 'number' && typeof value.ring === 'number' && typeof value.teamsInHeat === 'boolean'
    && Array.isArray(value.custom) && value.custom.every((role) => isRecord(role) && typeof role.id === 'string' && typeof role.name === 'string' && typeof role.count === 'number');
}

/** The wizard as the organiser left it, or null when there is none or it can't be read. */
export function loadDraft(competitionId: number): DutyDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(competitionId));
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    if (!isRecord(data) || data.v !== 1 || !isSetup(data.setup) || !isRecord(data.slots) || !Array.isArray(data.overridden)) return null;
    if (![0, 1, 2].includes(data.step as number)) return null;
    const slots: SlotsByHeat = {};
    for (const [key, list] of Object.entries(data.slots)) {
      if (!Array.isArray(list) || !list.every(isSlot)) return null;
      slots[Number(key)] = list;
    }
    return { v: 1, step: data.step as 0 | 1 | 2, setup: data.setup, slots, overridden: data.overridden.filter((id): id is number => typeof id === 'number') };
  } catch { return null; }
}

export function saveDraft(competitionId: number, draft: DutyDraft): void {
  try { localStorage.setItem(draftKey(competitionId), JSON.stringify(draft)); } catch { /* storage is full or blocked: the wizard still works */ }
}

export function clearDraft(competitionId: number): void {
  try { localStorage.removeItem(draftKey(competitionId)); } catch { /* nothing to clear */ }
}

/** Brings a saved draft up to date with the event: heats that are gone drop out, new heats get the setup's roles. */
export function freshenDraft(draft: DutyDraft, sessions: readonly DutySession[]): SlotState {
  const specs = templateSpecs(draft.setup);
  const slots: SlotsByHeat = {};
  for (const { heats } of sessions) for (const heat of heats) slots[heat.id] = draft.slots[heat.id] ?? reconcileSlots(specs, [], false);
  return { slots, overridden: draft.overridden.filter((id) => id in slots) };
}
