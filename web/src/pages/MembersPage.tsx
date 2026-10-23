import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronLeft, ChevronUp, UserMinus } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { PageSkeleton } from '../components/Skeletons';
import { apiErrorMessage } from '../lib/apiError';
import { applyRoleChange, canEditMember, groupMembers, memberSubline, MEMBER_GROUPS, ROLE_LABEL, withoutMember, wantsToJoinAs } from '../lib/members';
import { initialsOf } from '../lib/profile';
import type { Club, ClubMembers, ClubRoleChange, MemberRole, TrainerRequest } from '../types';
import { Field } from './auth/Field';
import { useNeedsYou } from './profile/needsYou';
import { SelectField } from '../components/SelectField';

/**
 * The club's people, for its team manager (their own club) or an admin (any club): who is waiting to join,
 * and everyone else by role, with a role switch and Remove from club on each row (docs/designs/members-handoff.md).
 */
export function MembersPage() {
  const { user, hasRole, canEdit } = useAuth();
  const { review } = useNeedsYou();
  const isAdmin = hasRole('Admin');
  const [clubs, setClubs] = useState<Club[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const clubId = isAdmin ? picked ?? user?.clubId ?? null : user?.clubId ?? null;
  // Remember which club the list is for, so a slow answer for the last one is never shown under the next.
  const [loaded, setLoaded] = useState<{ clubId: number; data: ClubMembers } | null>(null);
  const [loadFailed, setLoadFailed] = useState<number | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    api.get<Club[]>('/clubs').then((r) => { if (!cancelled && Array.isArray(r.data)) setClubs(r.data); }).catch(() => {});
    return () => { cancelled = true; };
  }, [isAdmin]);

  // Bumped to fetch the list again, e.g. after an approval puts someone into a group.
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (clubId == null) return;
    let cancelled = false;
    api.get<ClubMembers>(`/clubs/${clubId}/members`).then(({ data }) => {
      if (cancelled) return;
      if (!data || !Array.isArray(data.members) || !Array.isArray(data.pending)) throw new Error('unexpected response');
      setLoaded({ clubId, data });
      setLoadFailed(null);
    }).catch(() => { if (!cancelled) setLoadFailed(clubId); });
    return () => { cancelled = true; };
  }, [clubId, version]);

  if (!user) return null;
  const data = loaded && loaded.clubId === clubId ? loaded.data : null;
  // The admin lock guards an admin's own changes; a team manager has no such switch.
  const locked = isAdmin && !canEdit();
  const lockedTitle = locked ? 'Switch to edit mode' : undefined;

  function edit(change: (current: ClubMembers) => ClubMembers) {
    setLoaded((cur) => (cur && cur.clubId === clubId ? { ...cur, data: change(cur.data) } : cur));
  }

  async function decide(request: TrainerRequest, action: 'approve' | 'decline') {
    setNotice(null);
    if (!(await review(request, action))) {
      setNotice('Could not update this request. Try again.');
      return;
    }
    // An approved person joins a group, so fetch the list again rather than guess which one.
    setVersion((v) => v + 1);
  }

  async function setRole(userId: string, role: MemberRole) {
    if (clubId == null || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const { data: change } = await api.put<ClubRoleChange>(`/clubs/${clubId}/members/${encodeURIComponent(userId)}/role`, { role });
      edit((cur) => ({ ...cur, members: applyRoleChange(cur.members, userId, change) }));
    } catch (err) {
      setNotice(apiErrorMessage(err, 'Could not change the role. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(userId: string, name: string) {
    if (clubId == null || busy || !window.confirm(`Remove ${name} from ${data?.clubName ?? 'the club'}?`)) return;
    setBusy(true);
    setNotice(null);
    try {
      await api.delete(`/clubs/${clubId}/members/${encodeURIComponent(userId)}`);
      edit((cur) => ({ ...cur, members: withoutMember(cur.members, userId) }));
      setOpen(null);
    } catch (err) {
      setNotice(apiErrorMessage(err, 'Could not remove them. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  const groups = data ? groupMembers(data.members) : [];

  return (
    <div className="flex flex-col gap-6 pt-4">
      <div className="flex items-center gap-3">
        <Link to="/me" className="mg-icon-btn" aria-label="Back to my profile"><ChevronLeft aria-hidden="true" className="h-5 w-5" /></Link>
        <div className="min-w-0 flex-1">
          <h1 className="mg-display text-[26px] font-bold leading-none text-[rgb(var(--mg-heading))]">Members</h1>
          {(data?.clubName ?? user.clubName) && <p className="mg-meta mt-1 truncate !text-sm">{data?.clubName ?? user.clubName}</p>}
        </div>
      </div>

      {isAdmin && (
        <Field label="Club">
          {({ id }) => (
            <div className="mg-field">
              <SelectField id={id} value={clubId ?? ''} onChange={(e) => { setPicked(e.target.value ? Number(e.target.value) : null); setOpen(null); setNotice(null); }}>
                <option value="">Choose a club</option>
                {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </SelectField>
            </div>
          )}
        </Field>
      )}

      {notice && <p role="alert" className="text-sm font-medium text-[rgb(var(--mg-elim))]">{notice}</p>}
      {clubId != null && !data && (loadFailed === clubId
        ? <p role="alert" className="text-sm font-medium text-[rgb(var(--mg-elim))]">Could not load the members. Try again.</p>
        : <PageSkeleton />)}

      {data && data.pending.length > 0 && (
        <Section title="Waiting for you" aside={String(data.pending.length)}>
          {data.pending.map((request) => (
            <div key={request.userId} className="mg-card flex flex-col gap-2.5 px-3.5 py-3">
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className="mg-display flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--mg-late-bg))] text-[15px] font-bold text-[rgb(var(--mg-late-ink))]">
                  {initialsOf(request.fullName, request.email)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base font-semibold leading-tight">{request.fullName}</div>
                  <div className="text-sm text-[rgb(var(--mg-muted))]">Wants to join as {wantsToJoinAs(request)}</div>
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" className="mg-btn mg-btn-primary !min-h-11 flex-1 !text-[15px]" disabled={locked} title={lockedTitle} onClick={() => { void decide(request, 'approve'); }}>Approve</button>
                <button type="button" className="mg-btn mg-btn-secondary !min-h-11 flex-1 !text-[15px]" disabled={locked} title={lockedTitle} onClick={() => { void decide(request, 'decline'); }}>Decline</button>
              </div>
            </div>
          ))}
        </Section>
      )}

      {groups.map((group) => (
        <Section key={group.role} title={group.title} aside={String(group.people.length)}>
          <div className="mg-card mg-list">
            {group.people.map((member) => {
              const you = member.userId === user.id;
              const editable = canEditMember(member, user.id, isAdmin);
              const expanded = open === member.userId && editable;
              const sub = memberSubline(member);
              return (
                <div key={member.userId}>
                  <button type="button" className="mg-row !min-h-[60px] !gap-3 !px-3.5" aria-expanded={editable ? expanded : undefined} disabled={!editable && !you}
                    onClick={() => { if (editable) setOpen(expanded ? null : member.userId); }}>
                    <span aria-hidden="true" className="mg-display flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--mg-tint))] text-sm font-bold text-[rgb(var(--mg-heading))]">
                      {initialsOf(member.fullName)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-semibold leading-tight">{member.fullName}</span>
                      {sub && <span className="block truncate text-sm text-[rgb(var(--mg-muted))]">{sub}</span>}
                    </span>
                    {you && <span className="text-sm text-[rgb(var(--mg-muted))]">You</span>}
                    {editable && (expanded
                      ? <ChevronUp aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-[rgb(var(--mg-dash))]" />
                      : <ChevronDown aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-[rgb(var(--mg-dash))]" />)}
                  </button>
                  {expanded && (
                    <div className="flex flex-col gap-2.5 px-3.5 pb-3.5 pt-1">
                      <div role="group" aria-label={`Role for ${member.fullName}`} className="mg-seg !grid-cols-3">
                        {MEMBER_GROUPS.map(({ role }) => (
                          <button key={role} type="button" aria-pressed={member.role === role} disabled={locked || busy} title={lockedTitle}
                            onClick={() => { if (member.role !== role) void setRole(member.userId, role); }}>
                            {ROLE_LABEL[role]}
                          </button>
                        ))}
                      </div>
                      <button type="button" disabled={locked || busy} title={lockedTitle} onClick={() => { void remove(member.userId, member.fullName); }}
                        className="flex min-h-11 items-center gap-2 text-[15px] font-semibold text-[rgb(var(--mg-elim))] disabled:opacity-50">
                        <UserMinus aria-hidden="true" className="h-[18px] w-[18px]" />Remove from club
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      ))}
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <div className="mg-section-head"><h2>{title}</h2>{aside && <span>{aside}</span>}</div>
      {children}
    </section>
  );
}
