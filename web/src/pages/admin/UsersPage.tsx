import { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../../api';
import { Notice } from '../../components/Notice';
import { useAuth } from '../../auth/AuthContext';
import { confirmDialog } from '../../components/ConfirmDialog';
import { problemMessage } from '../../lib/apiError';
import { RefineChoiceRow, RefineHeader, RefineList, RefineMenu, RefinePage } from '../refine/Refine';
import { accountKind, type AccountInvite, type AdminUser, type InviteAccess, type StaffAccount } from './accountAccessTypes';
import { useAccountSearch } from './useAccountSearch';
import { AnimatePresence } from 'framer-motion';
import { LeavingRow } from '../../components/LeavingRow';
import '../operations/operations.css';

/** The shared organiser sign-in can never be locked or blocked. */
export const SHARED_ADMIN_EMAIL = 'admin@mg.local';

const ACCESS_OPTIONS: { value: 'organiser' | 'admin'; label: string }[] = [{ value: 'organiser', label: 'Organiser' }, { value: 'admin', label: 'Site admin' }];
const ACCESS_HINT = { organiser: 'Organisers can create competitions and run their own.', admin: 'Site admins can open and change every competition.' };
const EMAIL_PATTERN = /.+@.+\..+/;

const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');

function inviteDetail(invite: AccountInvite): string {
  const kind = invite.access === 1 ? 'Site admin' : 'Organiser';
  const state = invite.isExpired ? 'link expired' : invite.emailStatus === 2 ? 'email failed' : invite.emailStatus === 3 ? 'email sending is off' : 'not signed up yet';
  return `${kind} · sent ${shortDate(invite.lastSentAt ?? invite.createdAt)} · ${state}`;
}

/** Whether the signed-in admin may lock or unlock this staff account: never themselves, a master admin or the shared sign-in, and only a master admin for site admins. */
function mayLock(account: { id: string; email: string | null; roles: readonly string[] }, callerId: string | undefined, callerIsMaster: boolean): boolean {
  if (account.id === callerId || account.roles.includes('MasterAdmin')) return false;
  if (account.email?.toLowerCase() === SHARED_ADMIN_EMAIL) return false;
  return callerIsMaster || !account.roles.includes('Admin');
}

/** Site admin: invite organisers and site admins, lock staff accounts, and find anyone to make an admin or block. */
export function UsersPage() {
  const { user, hasRole } = useAuth();
  const isMaster = hasRole('MasterAdmin');
  const [staff, setStaff] = useState<StaffAccount[] | null>(null);
  const [invites, setInvites] = useState<AccountInvite[] | null>(null);
  const [email, setEmail] = useState('');
  const [access, setAccess] = useState<'organiser' | 'admin'>('organiser');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const search = useAccountSearch(query);

  const loadStaff = useCallback(() => api.get<StaffAccount[]>('/admin/staff-accounts')
    .then(({ data }) => setStaff(Array.isArray(data) ? data : []))
    .catch(() => { setStaff((current) => current ?? []); setError('Couldn’t load the admins. Check your signal and try again.'); }), []);

  useEffect(() => {
    let cancelled = false;
    void loadStaff();
    api.get<AccountInvite[]>('/admin/invites')
      .then(({ data }) => { if (!cancelled) setInvites(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setInvites([]); });
    return () => { cancelled = true; };
  }, [loadStaff]);

  async function run(work: () => Promise<void>, failure: string) {
    setBusy(true);
    setError(null);
    try { await work(); } catch (caught) { setError(problemMessage(caught, failure)); } finally { setBusy(false); }
  }

  const canSend = EMAIL_PATTERN.test(email.trim());
  const sendInvite = () => run(async () => {
    const { data } = await api.post<AccountInvite>('/admin/invites', { email: email.trim(), access: (access === 'admin' ? 1 : 0) satisfies InviteAccess });
    setInvites((current) => [data, ...(current ?? []).filter((i) => i.id !== data.id)]);
    setEmail('');
  }, 'Couldn’t send that invite. Check your signal and try again.');

  const resend = (invite: AccountInvite) => run(async () => {
    const { data } = await api.post<AccountInvite>(`/admin/invites/${invite.id}/resend`);
    setInvites((current) => (current ?? []).map((i) => (i.id === data.id ? data : i)));
  }, 'Couldn’t send that invite again. Check your signal and try again.');

  async function cancel(invite: AccountInvite) {
    if (!(await confirmDialog({ title: 'Cancel this invite?', message: `The link sent to ${invite.email} stops working.`, cancelLabel: 'Keep invite', confirmLabel: 'Cancel invite', destructive: true }))) return;
    await run(async () => {
      await api.delete(`/admin/invites/${invite.id}`);
      setInvites((current) => (current ?? []).filter((i) => i.id !== invite.id));
    }, 'Couldn’t cancel that invite. Check your signal and try again.');
  }

  const setLock = (account: StaffAccount, lock: boolean) => run(async () => {
    if (lock) await api.post(`/admin/users/${encodeURIComponent(account.id)}/account-lock`);
    else await api.delete(`/admin/users/${encodeURIComponent(account.id)}/account-lock`);
    setStaff((current) => (current ?? []).map((a) => (a.id === account.id ? { ...a, lockedAt: lock ? new Date().toISOString() : null } : a)));
  }, lock ? `Couldn’t lock ${account.fullName}. Check your signal and try again.` : `Couldn’t unlock ${account.fullName}. Check your signal and try again.`);

  async function lock(account: StaffAccount) {
    if (!(await confirmDialog({ title: `Lock ${account.fullName}?`, message: 'They’re signed out now and can’t sign in until you unlock them.', confirmLabel: 'Lock account', destructive: true }))) return;
    await setLock(account, true);
  }

  const makeAdmin = (person: AdminUser, role: 'Trainer' | 'Admin') => run(async () => {
    await api.post(`/admin/users/${encodeURIComponent(person.id)}/roles`, { role, grant: true });
    search.patch(person.id, { roles: [...person.roles, role] });
    await loadStaff();
  }, `Couldn’t change ${person.fullName}. Check your signal and try again.`);

  async function block(person: AdminUser) {
    if (!(await confirmDialog({ title: `Block ${person.fullName}?`, message: 'They can’t sign in, enter competitions or post in chat.', confirmLabel: 'Block account', destructive: true }))) return;
    await run(async () => {
      await api.post(`/admin/users/${encodeURIComponent(person.id)}/block`, {});
      search.patch(person.id, { isBlocked: true });
    }, `Couldn’t block ${person.fullName}. Check your signal and try again.`);
  }

  const unblock = (person: AdminUser) => run(async () => {
    await api.delete(`/admin/users/${encodeURIComponent(person.id)}/block`);
    search.patch(person.id, { isBlocked: false });
  }, `Couldn’t unblock ${person.fullName}. Check your signal and try again.`);

  // Admins and organisers are listed above; the search is for everyone else.
  const others = (search.results ?? []).filter((u) => !u.roles.some((r) => r === 'Admin' || r === 'MasterAdmin' || r === 'Trainer'));
  const typed = query.trim().length > 0;

  return (
    <RefinePage>
      <RefineHeader back="/admin" backLabel="Back to site admin" context="Site admin" title="Users" />
      <div className="ops-cards ops-tt ops-admin ops-people" aria-busy={busy}>
        {error && <Notice>{error}</Notice>}

        <h2 className="rf-sec ops-tt-head"><span>Invite an admin</span></h2>
        <RefineList as="div" label="Invite an admin">
          <label className="rf-row ops-emailrow">
            <span className="rf-grow rf-t1">Email</span>
            <input className="ops-inrow" type="email" inputMode="email" autoComplete="off" placeholder="name@example.com" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <RefineChoiceRow label="Access" value={access} options={ACCESS_OPTIONS} onChange={setAccess} />
        </RefineList>
        <div className="ops-sendrow">
          <span className="rf-note rf-grow">{ACCESS_HINT[access]}</span>
          <button type="button" className="rf-btn rf-btn-primary" disabled={!canSend || busy} onClick={() => void sendInvite()}>Send invite</button>
        </div>

        {invites !== null && invites.length > 0 && (
          <>
            <h2 className="rf-sec ops-tt-head"><span>Invites sent</span></h2>
            <RefineList as="div" label="Invites sent">
              <AnimatePresence initial={false}>
              {invites.map((invite) => (
                <LeavingRow as="div" key={invite.id} className="rf-row">
                  <span className="rf-grow"><span className="rf-t1">{invite.email}</span><span className="rf-t2">{inviteDetail(invite)}</span></span>
                  <span className="ops-acts">
                    <button type="button" className="rf-btn" aria-label={`Resend the invite to ${invite.email}`} disabled={busy} onClick={() => void resend(invite)}>Resend</button>
                    <button type="button" className="ops-danger-link" aria-label={`Cancel the invite to ${invite.email}`} disabled={busy} onClick={() => void cancel(invite)}>Cancel invite</button>
                  </span>
                </LeavingRow>
              ))}
              </AnimatePresence>
            </RefineList>
          </>
        )}

        <h2 className="rf-sec ops-tt-head"><span>Admins</span></h2>
        {staff === null && <p role="status" className="rf-note">Loading…</p>}
        {staff !== null && (
          <RefineList as="div" label="Admins">
            {staff.map((account) => {
              const locked = account.lockedAt !== null;
              const allowed = mayLock(account, user?.id, isMaster);
              return (
                <div key={account.id} className={`rf-row ${locked ? 'is-off' : ''}`.trim()}>
                  <span className="rf-grow">
                    <span className="rf-t1">{account.fullName}{account.id === user?.id ? ' (you)' : ''}</span>
                    <span className="rf-t2">{[account.email, accountKind(account.roles), locked ? 'locked' : null].filter(Boolean).join(' · ')}</span>
                  </span>
                  {allowed && locked && <button type="button" className="rf-btn" aria-label={`Unlock ${account.fullName}`} disabled={busy} onClick={() => void setLock(account, false)}>Unlock</button>}
                  {allowed && !locked && <button type="button" className="ops-danger-link" aria-label={`Lock ${account.fullName}`} disabled={busy} onClick={() => void lock(account)}>Lock</button>}
                </div>
              );
            })}
            {staff.length === 0 && <div className="rf-row"><span className="rf-t2">No admins yet</span></div>}
          </RefineList>
        )}

        <h2 className="rf-sec ops-tt-head"><span>Everyone else</span></h2>
        <label className="ops-search">
          <Search className="h-[18px] w-[18px]" aria-hidden="true" />
          <input type="search" aria-label="Search accounts" placeholder="Search by name or email" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        {typed && (
          <RefineList as="div" label="Matching accounts">
            {search.searching && <div className="rf-row"><span className="rf-t2" role="status">Searching…</span></div>}
            {others.map((person) => (
              <div key={person.id} className={`rf-row ${person.isBlocked ? 'is-off' : ''}`.trim()}>
                <span className="rf-grow">
                  <span className="rf-t1">{person.fullName}</span>
                  <span className="rf-t2">{[person.email, accountKind(person.roles), person.isBlocked ? 'blocked' : null].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="ops-acts">
                  {isMaster && !person.isBlocked && (
                    <RefineMenu text="Make admin" label={`Make ${person.fullName} an admin`} disabled={busy} items={[
                      { label: 'Make organiser', onSelect: () => void makeAdmin(person, 'Trainer') },
                      { label: 'Make site admin', onSelect: () => void makeAdmin(person, 'Admin') },
                    ]} />
                  )}
                  {person.isBlocked
                    ? <button type="button" className="rf-btn" aria-label={`Unblock ${person.fullName}`} disabled={busy} onClick={() => void unblock(person)}>Unblock</button>
                    : <button type="button" className="ops-danger-link" aria-label={`Block ${person.fullName}`} disabled={busy} onClick={() => void block(person)}>Block</button>}
                </span>
              </div>
            ))}
            {!search.searching && search.failed && <div className="rf-row"><span className="rf-t2">Couldn’t search. Check your signal and try again.</span></div>}
            {!search.searching && !search.failed && others.length === 0 && <div className="rf-row"><span className="rf-t2">No account matches that</span></div>}
          </RefineList>
        )}
      </div>
    </RefinePage>
  );
}
