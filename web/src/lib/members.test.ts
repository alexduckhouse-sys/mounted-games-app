import { describe, expect, it } from 'vitest';
import type { ClubMember } from '../types';
import { applyRoleChange, canEditMember, groupMembers, memberSubline, wantsToJoinAs, withoutMember } from './members';

const person = (userId: string, role: ClubMember['role'], extra: Partial<ClubMember> = {}): ClubMember =>
  ({ userId, fullName: userId, role, teams: [], awaitingAdmin: false, ...extra });

describe('groupMembers', () => {
  it('puts team managers first, then trainers, then members, and leaves empty groups out', () => {
    const groups = groupMembers([person('m1', 'Member'), person('t1', 'Trainer'), person('b1', 'Manager'), person('t2', 'Trainer')]);
    expect(groups.map((g) => [g.title, g.people.map((p) => p.userId)])).toEqual([
      ['Team managers', ['b1']], ['Trainers', ['t1', 't2']], ['Members', ['m1']],
    ]);
    expect(groupMembers([person('t1', 'Trainer')]).map((g) => g.title)).toEqual(['Trainers']);
    expect(groupMembers([])).toEqual([]);
  });
});

describe('memberSubline', () => {
  it('lists a trainer\'s teams', () => {
    expect(memberSubline(person('t', 'Trainer', { teams: ['Stockport A', 'Stockport B'] }))).toBe('Stockport A, Stockport B');
  });

  it('is empty when there is nothing to say', () => {
    expect(memberSubline(person('t', 'Trainer'))).toBe('');
    expect(memberSubline(person('m', 'Member', { teams: ['Left over'] }))).toBe('');
  });

  it('says when an admin has to approve a change', () => {
    expect(memberSubline(person('t', 'Trainer', { teams: ['A'], awaitingAdmin: true }))).toBe('Waiting for an admin to approve');
  });
});

describe('canEditMember', () => {
  it('never lets you edit yourself', () => {
    expect(canEditMember(person('me', 'Trainer'), 'me', true)).toBe(false);
  });

  it('keeps team managers for the admins', () => {
    expect(canEditMember(person('b', 'Manager'), 'me', false)).toBe(false);
    expect(canEditMember(person('b', 'Manager'), 'me', true)).toBe(true);
  });

  it('lets a manager edit trainers and members', () => {
    expect(canEditMember(person('t', 'Trainer'), 'me', false)).toBe(true);
    expect(canEditMember(person('m', 'Member'), undefined, false)).toBe(true);
  });
});

describe('wantsToJoinAs', () => {
  it('names the role that was asked for', () => {
    const base = { userId: 'u', fullName: 'U', email: null, clubName: null, requestedAt: '2026-10-20T09:00:00Z' };
    expect(wantsToJoinAs({ ...base, requestedRole: 'Manager' })).toBe('a team manager');
    expect(wantsToJoinAs({ ...base, requestedRole: 'Trainer' })).toBe('a trainer');
    expect(wantsToJoinAs(base)).toBe('a trainer');
  });
});

describe('applyRoleChange', () => {
  const list = [person('a', 'Member'), person('b', 'Trainer', { teams: ['A'] })];

  it('moves the person to their new group', () => {
    expect(applyRoleChange(list, 'a', { role: 'Trainer', awaitingAdmin: false })[0]).toMatchObject({ role: 'Trainer', awaitingAdmin: false });
  });

  it('drops a trainer\'s teams when they become a plain member', () => {
    expect(applyRoleChange(list, 'b', { role: 'Member', awaitingAdmin: false })[1]).toMatchObject({ role: 'Member', teams: [] });
  });

  it('keeps the role when an admin has to approve', () => {
    expect(applyRoleChange(list, 'b', { role: 'Trainer', awaitingAdmin: true })[1]).toMatchObject({ role: 'Trainer', teams: ['A'], awaitingAdmin: true });
  });

  it('leaves everyone else alone', () => {
    expect(applyRoleChange(list, 'a', { role: 'Trainer', awaitingAdmin: false })[1]).toBe(list[1]);
  });
});

describe('withoutMember', () => {
  it('drops one person', () => {
    expect(withoutMember([person('a', 'Member'), person('b', 'Member')], 'a').map((p) => p.userId)).toEqual(['b']);
  });
});
