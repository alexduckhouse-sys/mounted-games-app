import type { ClubMember, ClubRoleChange, MemberRole, TrainerRequest } from '../types';

/** The three groups on the Members screen, most senior first. */
export const MEMBER_GROUPS: { role: MemberRole; title: string }[] = [
  { role: 'Manager', title: 'Club managers' },
  { role: 'Trainer', title: 'Trainers' },
  { role: 'Member', title: 'Members' },
];

/** The three choices on a person's role switch. */
export const ROLE_LABEL: Record<MemberRole, string> = { Manager: 'Club manager', Trainer: 'Trainer', Member: 'Member' };

/** Groups with nobody in them are left out. */
export function groupMembers(members: readonly ClubMember[]): { role: MemberRole; title: string; people: ClubMember[] }[] {
  return MEMBER_GROUPS
    .map((group) => ({ ...group, people: members.filter((m) => m.role === group.role) }))
    .filter((group) => group.people.length > 0);
}

/** "Stockport A, B" is what the design shows for a trainer; others have no second line unless a request is waiting. */
export function memberSubline(member: ClubMember): string {
  if (member.awaitingAdmin) return 'Waiting for an admin to approve';
  return member.role === 'Member' ? '' : member.teams.join(', ');
}

/** You can't edit yourself, and only an admin changes a club manager. */
export function canEditMember(member: ClubMember, myId: string | undefined, isAdmin: boolean): boolean {
  if (member.userId === myId) return false;
  return isAdmin || member.role !== 'Manager';
}

/** "Wants to join as {role}". */
export function wantsToJoinAs(request: TrainerRequest): string {
  return request.requestedRole === 'Manager' ? 'a club manager' : 'a trainer';
}

/** The list after a role change came back: applied at once, or filed with the admins and left as it was. */
export function applyRoleChange(members: readonly ClubMember[], userId: string, change: ClubRoleChange): ClubMember[] {
  return members.map((m) => (m.userId === userId
    ? { ...m, role: change.role, awaitingAdmin: change.awaitingAdmin, teams: change.role === 'Member' ? [] : m.teams }
    : m));
}

export const withoutMember = (members: readonly ClubMember[], userId: string): ClubMember[] => members.filter((m) => m.userId !== userId);
