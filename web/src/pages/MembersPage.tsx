import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { CardDropdownRow } from '../components/CardDropdownRow';
import { usePageHeader } from '../components/CompactPageBarContext';
import { confirmDialog } from '../components/ConfirmDialog';
import { Notice } from '../components/Notice';
import { PageSkeleton } from '../components/Skeletons';
import { apiErrorMessage } from '../lib/apiError';
import { applyRoleChange, canEditMember, groupMembers, memberGroups, memberSubline, roleLabel, withoutMember, wantsToJoinAs } from '../lib/members';
import { useT } from '../i18n/LanguageContext';
import type { Club, ClubMember, ClubMembers, ClubRoleChange, MemberRole, TrainerRequest } from '../types';
import { Avatar, Chip, PickSheet } from './clubShop/ui';
import { useNeedsYou } from './profile/needsYou';
import '../components/sitePages.css';
import './clubShop/clubShop.css';

/**
 * The club's people, for its club manager (their own club) or an admin (any club): who is waiting to join, and
 * everyone else by role. A ⋯ on each row opens a sheet to change their role or remove them from the club.
 */
export function MembersPage() {
  const t = useT();
  const { user, hasRole } = useAuth();
  const { review, reviewError } = useNeedsYou();
  const isAdmin = hasRole('Admin');
  const [clubs, setClubs] = useState<Club[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const clubId = isAdmin ? picked ?? user?.clubId ?? null : user?.clubId ?? null;
  // Remember which club the list is for, so a slow answer for the last one is never shown under the next.
  const [loaded, setLoaded] = useState<{ clubId: number; data: ClubMembers } | null>(null);
  const [loadFailed, setLoadFailed] = useState<number | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // An approve or decline that failed: the reason (the server's, such as an unconfirmed address) comes from `reviewError`.
  const [reviewFailed, setReviewFailed] = useState(false);
  const shown = notice ?? (reviewFailed ? reviewError || t('acct.members.reviewFail') : null);
  const [busy, setBusy] = useState(false);
  // The request being approved or declined, so its buttons switch off until the answer comes back.
  const [deciding, setDeciding] = useState<string | null>(null);
  const data = loaded && loaded.clubId === clubId ? loaded.data : null;
  usePageHeader({ title: t('acct.members.title'), subtitle: data?.clubName ?? user?.clubName ?? undefined, plain: true, backTo: '/me', backLabel: t('acct.members.back') });

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
    api.get<ClubMembers>(`/clubs/${clubId}/members`).then(({ data: d }) => {
      if (cancelled) return;
      if (!d || !Array.isArray(d.members) || !Array.isArray(d.pending)) throw new Error('unexpected response');
      setLoaded({ clubId, data: d });
      setLoadFailed(null);
    }).catch(() => { if (!cancelled) setLoadFailed(clubId); });
    return () => { cancelled = true; };
  }, [clubId, version]);

  if (!user) return null;

  function edit(change: (current: ClubMembers) => ClubMembers) {
    setLoaded((cur) => (cur && cur.clubId === clubId ? { ...cur, data: change(cur.data) } : cur));
  }

  async function decide(request: TrainerRequest, action: 'approve' | 'decline') {
    if (deciding) return;
    if (action === 'decline' && !(await confirmDialog({
      title: t('acct.members.declineTitle'),
      message: t('acct.members.declineMessage', { name: request.fullName }),
      confirmLabel: t('acct.members.declineConfirm'),
      destructive: true,
    }))) return;
    setNotice(null);
    setReviewFailed(false);
    setDeciding(request.userId);
    try {
      if (!(await review(request, action))) {
        setReviewFailed(true);
        return;
      }
      // An approved person joins a group, so fetch the list again rather than guess which one.
      setVersion((v) => v + 1);
    } finally {
      setDeciding(null);
    }
  }

  async function setRole(userId: string, role: MemberRole) {
    if (clubId == null || busy) return;
    setBusy(true);
    setNotice(null);
    setReviewFailed(false);
    try {
      const { data: change } = await api.put<ClubRoleChange>(`/clubs/${clubId}/members/${encodeURIComponent(userId)}/role`, { role });
      edit((cur) => ({ ...cur, members: applyRoleChange(cur.members, userId, change) }));
    } catch (err) {
      setNotice(apiErrorMessage(err, t('acct.members.roleFail')));
    } finally {
      setBusy(false);
    }
  }

  /** Asks first. Returns whether they were removed, so the sheet can slide away. */
  async function remove(member: ClubMember): Promise<boolean> {
    if (clubId == null || busy) return false;
    if (!(await confirmDialog({ title: t('acct.members.removeTitle'), message: t('acct.members.removeMessage', { name: member.fullName, club: data?.clubName ?? t('acct.members.theClub') }), confirmLabel: t('acct.members.remove'), destructive: true }))) return false;
    setBusy(true);
    setNotice(null);
    setReviewFailed(false);
    try {
      await api.delete(`/clubs/${clubId}/members/${encodeURIComponent(member.userId)}`);
      edit((cur) => ({ ...cur, members: withoutMember(cur.members, member.userId) }));
      return true;
    } catch (err) {
      setNotice(apiErrorMessage(err, t('acct.members.removeFail')));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const groups = data ? groupMembers(data.members) : [];
  const menuMember = data?.members.find((m) => m.userId === menuFor) ?? null;

  return (
    <div className="skin cs-page">
      <h1 className="sr-only">{t('acct.members.title')}</h1>

      {isAdmin && (
        <div className="sp-card">
          <CardDropdownRow label={t('acct.members.club')} value={clubId == null ? '' : String(clubId)}
            options={[{ value: '', label: t('acct.members.chooseClub') }, ...clubs.map((c) => ({ value: String(c.id), label: c.name }))]}
            onChange={(value) => { setPicked(value ? Number(value) : null); setMenuFor(null); setNotice(null); setReviewFailed(false); }} />
        </div>
      )}

      {shown && <div className="cs-gap"><Notice>{shown}</Notice></div>}
      {clubId == null && <p className="sp-note">{isAdmin ? t('acct.members.pickClub') : t('acct.members.noClub')}</p>}
      {clubId != null && !data && (
        <div className="cs-gap">
          {loadFailed === clubId
            ? <Notice actionLabel={t('acct.members.tryAgain')} onAction={() => { setLoadFailed(null); setVersion((v) => v + 1); }}>{t('acct.members.loadFail')}</Notice>
            : <PageSkeleton />}
        </div>
      )}

      {data && data.pending.length > 0 && (
        <section aria-label={t('acct.members.waiting')}>
          <h2 className="sp-sec">{t('acct.members.waiting')} <small>{data.pending.length}</small></h2>
          <div className="sp-card">
            {data.pending.map((request) => (
              <div key={request.userId} className="cs-row">
                <Avatar name={request.fullName} />
                <span className="sp-grow">
                  <span className="sp-t1">{request.fullName}</span>
                  <span className="sp-t2">{t('acct.members.wantsToJoin', { role: wantsToJoinAs(request) })}</span>
                </span>
                <button type="button" className="kit-redtext cs-redtext-s cs-tap44" aria-label={t('acct.members.declineFor', { name: request.fullName })} disabled={deciding !== null} onClick={() => { void decide(request, 'decline'); }}>{t('acct.members.decline')}</button>
                <button type="button" className="kit-pill kit-pill-fill cs-pill-s cs-tap44" aria-label={t('acct.members.approveFor', { name: request.fullName })} disabled={deciding !== null} onClick={() => { void decide(request, 'approve'); }}>{t('acct.members.approve')}</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {groups.map((group) => (
        <section key={group.role} aria-label={group.title}>
          <h2 className="sp-sec">{group.title} <small>{group.people.length}</small></h2>
          <div className="sp-card">
            {group.people.map((member) => {
              const you = member.userId === user.id;
              const editable = canEditMember(member, user.id, isAdmin);
              const sub = memberSubline(member);
              return (
                <div key={member.userId} className="cs-row">
                  <Avatar name={member.fullName} />
                  <span className="sp-grow">
                    <span className="sp-t1">{member.fullName}</span>
                    {sub && <span className="sp-t2">{sub}</span>}
                  </span>
                  {you && <Chip tone="grey">{t('acct.members.you')}</Chip>}
                  {editable && <button type="button" className="cs-more" aria-label={t('acct.members.moreFor', { name: member.fullName })} onClick={() => setMenuFor(member.userId)}>⋯</button>}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {menuMember && (
        <PickSheet
          title={menuMember.fullName}
          options={memberGroups().filter(({ role }) => isAdmin || role !== 'Manager').map(({ role }) => ({ value: role, label: roleLabel(role) }))}
          value={menuMember.role}
          onClose={() => setMenuFor(null)}
          onPick={(role) => { if (role !== menuMember.role) void setRole(menuMember.userId, role as MemberRole); }}
          footer={(close) => (
            <div className="kit-acts">
              <button type="button" className="kit-redtext" disabled={busy} onClick={() => { void remove(menuMember).then((removed) => { if (removed) close(); }); }}>{t('acct.members.remove')}</button>
            </div>
          )}
        />
      )}
    </div>
  );
}
