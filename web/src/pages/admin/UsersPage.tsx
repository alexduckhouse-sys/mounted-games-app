import { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../../api';
import { Notice } from '../../components/Notice';
import { useAuth } from '../../auth/AuthContext';
import { confirmDialog } from '../../components/ConfirmDialog';
import { problemMessage } from '../../lib/apiError';
import { useT } from '../../i18n/LanguageContext';
import { activeLocale, tr } from '../../i18n/translate';
import { RefineChoiceRow, RefineHeader, RefineList, RefineMenu, RefinePage } from '../refine/Refine';
import { accountKind, type AccountInvite, type AdminUser, type InviteAccess, type StaffAccount } from './accountAccessTypes';
import { useAccountSearch } from './useAccountSearch';
import { AnimatePresence } from 'framer-motion';
import { LeavingRow } from '../../components/LeavingRow';
import '../operations/operations.css';

/** The shared organiser sign-in can never be locked or blocked. */
export const SHARED_ADMIN_EMAIL = 'admin@mg.local';

const EMAIL_PATTERN = /.+@.+\..+/;

const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(activeLocale(), { day: 'numeric', month: 'short' }) : '');

function inviteDetail(invite: AccountInvite): string {
  const kind = invite.access === 1 ? tr('admin.accounts.users.siteAdmin') : tr('admin.accounts.users.organiser');
  const state = invite.isExpired ? tr('admin.accounts.users.stateExpired') : invite.emailStatus === 2 ? tr('admin.accounts.users.stateFailed') : invite.emailStatus === 3 ? tr('admin.accounts.users.stateOff') : tr('admin.accounts.users.stateNotSignedUp');
  return tr('admin.accounts.users.inviteDetail', { kind, date: shortDate(invite.lastSentAt ?? invite.createdAt), state });
}

/** Whether the signed-in admin may lock or unlock this staff account: never themselves, a master admin or the shared sign-in, and only a master admin for site admins. */
function mayLock(account: { id: string; email: string | null; roles: readonly string[] }, callerId: string | undefined, callerIsMaster: boolean): boolean {
  if (account.id === callerId || account.roles.includes('MasterAdmin')) return false;
  if (account.email?.toLowerCase() === SHARED_ADMIN_EMAIL) return false;
  return callerIsMaster || !account.roles.includes('Admin');
}

/** Site admin: invite organisers and site admins, lock staff accounts, and find anyone to make an admin or block. */
export function UsersPage() {
  const t = useT();
  const accessOptions: { value: 'organiser' | 'admin'; label: string }[] = [{ value: 'organiser', label: t('admin.accounts.users.organiser') }, { value: 'admin', label: t('admin.accounts.users.siteAdmin') }];
  const accessHint = { organiser: t('admin.accounts.users.hintOrganiser'), admin: t('admin.accounts.users.hintAdmin') };
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
    .catch(() => { setStaff((current) => current ?? []); setError(tr('admin.accounts.users.loadStaffFailed')); }), []);

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
  }, t('admin.accounts.users.inviteFailed'));

  const resend = (invite: AccountInvite) => run(async () => {
    const { data } = await api.post<AccountInvite>(`/admin/invites/${invite.id}/resend`);
    setInvites((current) => (current ?? []).map((i) => (i.id === data.id ? data : i)));
  }, t('admin.accounts.users.resendFailed'));

  async function cancel(invite: AccountInvite) {
    if (!(await confirmDialog({ title: t('admin.accounts.users.cancelInviteTitle'), message: t('admin.accounts.users.cancelInviteMessage', { email: invite.email }), cancelLabel: t('admin.accounts.users.keepInvite'), confirmLabel: t('admin.accounts.users.cancelInvite'), destructive: true }))) return;
    await run(async () => {
      await api.delete(`/admin/invites/${invite.id}`);
      setInvites((current) => (current ?? []).filter((i) => i.id !== invite.id));
    }, t('admin.accounts.users.cancelFailed'));
  }

  const setLock = (account: StaffAccount, lock: boolean) => run(async () => {
    if (lock) await api.post(`/admin/users/${encodeURIComponent(account.id)}/account-lock`);
    else await api.delete(`/admin/users/${encodeURIComponent(account.id)}/account-lock`);
    setStaff((current) => (current ?? []).map((a) => (a.id === account.id ? { ...a, lockedAt: lock ? new Date().toISOString() : null } : a)));
  }, lock ? t('admin.accounts.users.lockFailed', { name: account.fullName }) : t('admin.accounts.users.unlockFailed', { name: account.fullName }));

  async function lock(account: StaffAccount) {
    if (!(await confirmDialog({ title: t('admin.accounts.users.lockTitle', { name: account.fullName }), message: t('admin.accounts.users.lockMessage'), confirmLabel: t('admin.accounts.users.lockConfirm'), destructive: true }))) return;
    await setLock(account, true);
  }

  const makeAdmin = (person: AdminUser, role: 'Trainer' | 'Admin') => run(async () => {
    await api.post(`/admin/users/${encodeURIComponent(person.id)}/roles`, { role, grant: true });
    search.patch(person.id, { roles: [...person.roles, role] });
    await loadStaff();
  }, t('admin.accounts.users.changeFailed', { name: person.fullName }));

  async function block(person: AdminUser) {
    if (!(await confirmDialog({ title: t('admin.accounts.users.blockTitle', { name: person.fullName }), message: t('admin.accounts.users.blockMessage'), confirmLabel: t('admin.accounts.users.blockConfirm'), destructive: true }))) return;
    await run(async () => {
      await api.post(`/admin/users/${encodeURIComponent(person.id)}/block`, {});
      search.patch(person.id, { isBlocked: true });
    }, t('admin.accounts.users.blockFailed', { name: person.fullName }));
  }

  const unblock = (person: AdminUser) => run(async () => {
    await api.delete(`/admin/users/${encodeURIComponent(person.id)}/block`);
    search.patch(person.id, { isBlocked: false });
  }, t('admin.accounts.users.unblockFailed', { name: person.fullName }));

  // Admins and organisers are listed above; the search is for everyone else.
  const others = (search.results ?? []).filter((u) => !u.roles.some((r) => r === 'Admin' || r === 'MasterAdmin' || r === 'Trainer'));
  const typed = query.trim().length > 0;

  return (
    <RefinePage>
      <RefineHeader back="/admin" backLabel={t('admin.accounts.backToSiteAdmin')} context={t('admin.accounts.siteAdmin')} title={t('admin.accounts.users.title')} />
      <div className="ops-cards ops-tt ops-admin ops-people" aria-busy={busy}>
        {error && <Notice>{error}</Notice>}

        <h2 className="rf-sec ops-tt-head"><span>{t('admin.accounts.users.inviteHeading')}</span></h2>
        <RefineList as="div" label={t('admin.accounts.users.inviteHeading')}>
          <label className="rf-row ops-emailrow">
            <span className="rf-grow rf-t1">{t('admin.accounts.users.email')}</span>
            <input className="ops-inrow" type="email" inputMode="email" autoComplete="off" placeholder="name@example.com" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <RefineChoiceRow label={t('admin.accounts.users.access')} value={access} options={accessOptions} onChange={setAccess} />
        </RefineList>
        <div className="ops-sendrow">
          <span className="rf-note rf-grow">{accessHint[access]}</span>
          <button type="button" className="rf-btn rf-btn-primary" disabled={!canSend || busy} onClick={() => void sendInvite()}>{t('admin.accounts.users.sendInvite')}</button>
        </div>

        {invites !== null && invites.length > 0 && (
          <>
            <h2 className="rf-sec ops-tt-head"><span>{t('admin.accounts.users.invitesSent')}</span></h2>
            <RefineList as="div" label={t('admin.accounts.users.invitesSent')}>
              <AnimatePresence initial={false}>
              {invites.map((invite) => (
                <LeavingRow as="div" key={invite.id} className="rf-row">
                  <span className="rf-grow"><span className="rf-t1">{invite.email}</span><span className="rf-t2">{inviteDetail(invite)}</span></span>
                  <span className="ops-acts">
                    <button type="button" className="rf-btn" aria-label={t('admin.accounts.users.resendAria', { email: invite.email })} disabled={busy} onClick={() => void resend(invite)}>{t('admin.accounts.users.resend')}</button>
                    <button type="button" className="ops-danger-link" aria-label={t('admin.accounts.users.cancelAria', { email: invite.email })} disabled={busy} onClick={() => void cancel(invite)}>{t('admin.accounts.users.cancelInvite')}</button>
                  </span>
                </LeavingRow>
              ))}
              </AnimatePresence>
            </RefineList>
          </>
        )}

        <h2 className="rf-sec ops-tt-head"><span>{t('admin.accounts.users.admins')}</span></h2>
        {staff === null && <p role="status" className="rf-note">{t('common.loading')}</p>}
        {staff !== null && (
          <RefineList as="div" label={t('admin.accounts.users.admins')}>
            {staff.map((account) => {
              const locked = account.lockedAt !== null;
              const allowed = mayLock(account, user?.id, isMaster);
              return (
                <div key={account.id} className={`rf-row ${locked ? 'is-off' : ''}`.trim()}>
                  <span className="rf-grow">
                    <span className="rf-t1">{account.fullName}{account.id === user?.id ? t('admin.accounts.users.you') : ''}</span>
                    <span className="rf-t2">{[account.email, accountKind(account.roles), locked ? t('admin.accounts.users.locked') : null].filter(Boolean).join(' · ')}</span>
                  </span>
                  {allowed && locked && <button type="button" className="rf-btn" aria-label={t('admin.accounts.users.unlockAria', { name: account.fullName })} disabled={busy} onClick={() => void setLock(account, false)}>{t('admin.accounts.users.unlock')}</button>}
                  {allowed && !locked && <button type="button" className="ops-danger-link" aria-label={t('admin.accounts.users.lockAria', { name: account.fullName })} disabled={busy} onClick={() => void lock(account)}>{t('admin.accounts.users.lock')}</button>}
                </div>
              );
            })}
            {staff.length === 0 && <div className="rf-row"><span className="rf-t2">{t('admin.accounts.users.noAdmins')}</span></div>}
          </RefineList>
        )}

        <h2 className="rf-sec ops-tt-head"><span>{t('admin.accounts.users.everyoneElse')}</span></h2>
        <label className="ops-search">
          <Search className="h-[18px] w-[18px]" aria-hidden="true" />
          <input type="search" aria-label={t('admin.accounts.users.searchAria')} placeholder={t('admin.accounts.users.searchPlaceholder')} value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        {typed && (
          <RefineList as="div" label={t('admin.accounts.users.matching')}>
            {search.searching && <div className="rf-row"><span className="rf-t2" role="status">{t('admin.accounts.users.searching')}</span></div>}
            {others.map((person) => (
              <div key={person.id} className={`rf-row ${person.isBlocked ? 'is-off' : ''}`.trim()}>
                <span className="rf-grow">
                  <span className="rf-t1">{person.fullName}</span>
                  <span className="rf-t2">{[person.email, accountKind(person.roles), person.isBlocked ? t('admin.accounts.users.blockedTag') : null].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="ops-acts">
                  {isMaster && !person.isBlocked && (
                    <RefineMenu text={t('admin.accounts.users.makeAdmin')} label={t('admin.accounts.users.makeAdminAria', { name: person.fullName })} disabled={busy} items={[
                      { label: t('admin.accounts.users.makeOrganiser'), onSelect: () => void makeAdmin(person, 'Trainer') },
                      { label: t('admin.accounts.users.makeSiteAdmin'), onSelect: () => void makeAdmin(person, 'Admin') },
                    ]} />
                  )}
                  {person.isBlocked
                    ? <button type="button" className="rf-btn" aria-label={t('admin.accounts.users.unblockAria', { name: person.fullName })} disabled={busy} onClick={() => void unblock(person)}>{t('admin.accounts.users.unblock')}</button>
                    : <button type="button" className="ops-danger-link" aria-label={t('admin.accounts.users.blockAria', { name: person.fullName })} disabled={busy} onClick={() => void block(person)}>{t('admin.accounts.users.block')}</button>}
                </span>
              </div>
            ))}
            {!search.searching && search.failed && <div className="rf-row"><span className="rf-t2">{t('admin.accounts.users.searchFailed')}</span></div>}
            {!search.searching && !search.failed && others.length === 0 && <div className="rf-row"><span className="rf-t2">{t('admin.accounts.users.noMatch')}</span></div>}
          </RefineList>
        )}
      </div>
    </RefinePage>
  );
}
