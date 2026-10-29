import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { api, getIpBlocks, createIpBlock, deleteIpBlock, type IpBlock } from '../../api';
import { Notice } from '../../components/Notice';
import { confirmDialog } from '../../components/ConfirmDialog';
import { problemMessage } from '../../lib/apiError';
import { useT } from '../../i18n/LanguageContext';
import { useAuth } from '../../auth/AuthContext';
import { activeLocale, tr } from '../../i18n/translate';
import { RefineHeader, RefineList, RefinePage } from '../refine/Refine';
import { accountKind, type AdminUser, type BlockedAccount } from './accountAccessTypes';
import { useAccountSearch } from './useAccountSearch';
import { AnimatePresence } from 'framer-motion';
import { LeavingRow } from '../../components/LeavingRow';
import '../operations/operations.css';

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(activeLocale(), { day: 'numeric', month: 'short' });

/** Find an account, block it with a reason only admins see, and unblock accounts from the list below. */
export function BlockedAccountsPage() {
  const t = useT();
  const { hasRole } = useAuth();
  const master = hasRole('MasterAdmin');
  const [blocked, setBlocked] = useState<BlockedAccount[] | null>(null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const search = useAccountSearch(query);
  const [ipError, setIpError] = useState<string | null>(null);
  const [ipBlocks, setIpBlocks] = useState<IpBlock[] | null>(null);
  const [ip, setIp] = useState('');
  const [ipReason, setIpReason] = useState('');
  const [ipFormOpen, setIpFormOpen] = useState(false);
  const loadIpBlocks = () => getIpBlocks().then(({ data }) => { setIpError(null); setIpBlocks(Array.isArray(data) ? data.filter((block) => block && typeof block.id === 'number' && typeof block.ipAddress === 'string' && typeof block.createdAt === 'string') : []); })
    .catch(() => { setIpError('Couldn’t load blocked IP addresses. Try again.'); });
  useEffect(() => { if (master) void loadIpBlocks(); }, [master]);

  async function addIpBlock() {
    if (!ip.trim() || busy) return;
    if (!(await confirmDialog({ title: 'Block this IP address?', message: 'This blocks everyone using this network, which may include other people at the event.', confirmLabel: 'Block address', destructive: true }))) return;
    await run(async () => {
      await createIpBlock({ ip: ip.trim(), reason: ipReason.trim() });
      setIp(''); setIpReason(''); setIpFormOpen(false);
      await loadIpBlocks();
    }, 'Couldn’t block that address. Check it and try again.');
  }

  const maskedIp = (value: string) => value.startsWith('sha256:') || value.length > 45
    ? `Network ${value.slice(-8)}`
    : value.includes(':') ? `${value.split(':').slice(0, 2).join(':')}:…` : value.replace(/\.\d+$/, '.*');

  const load = () => api.get<BlockedAccount[]>('/admin/blocked-users')
    .then(({ data }) => setBlocked(Array.isArray(data) ? data : []))
    .catch(() => { setBlocked((current) => current ?? []); setError(tr('admin.accounts.blocked.loadFailed')); });
  useEffect(() => {
    void load();
  }, []);

  async function run(work: () => Promise<void>, failure: string) {
    setBusy(true);
    setError(null);
    try { await work(); } catch (caught) { setError(problemMessage(caught, failure)); } finally { setBusy(false); }
  }

  async function block(person: AdminUser) {
    if (!(await confirmDialog({ title: t('admin.accounts.users.blockTitle', { name: person.fullName }), message: t('admin.accounts.users.blockMessage'), confirmLabel: t('admin.accounts.users.blockConfirm'), destructive: true }))) return;
    await run(async () => {
      await api.post(`/admin/users/${encodeURIComponent(person.id)}/block`, { reason: reason.trim() || null });
      search.patch(person.id, { isBlocked: true });
      setPicked(null);
      setReason('');
      await load();
    }, t('admin.accounts.users.blockFailed', { name: person.fullName }));
  }

  async function unblock(account: BlockedAccount) {
    await run(async () => {
      await api.delete(`/admin/users/${encodeURIComponent(account.id)}/block`);
      search.patch(account.id, { isBlocked: false });
      setBlocked((current) => (current ?? []).filter((b) => b.id !== account.id));
    }, t('admin.accounts.users.unblockFailed', { name: account.fullName }));
  }

  const typed = query.trim().length > 0;
  const hits = search.results ?? [];

  return (
    <RefinePage>
      <RefineHeader back="/admin" backLabel={t('admin.accounts.backToSiteAdmin')} context={t('admin.accounts.siteAdmin')} title={t('admin.accounts.blocked.title')} />
      <div className="ops-cards ops-tt ops-admin ops-people" aria-busy={busy}>
        {error && <Notice>{error}</Notice>}

        <label className="ops-search">
          <Search className="h-[18px] w-[18px]" aria-hidden="true" />
          <input type="search" aria-label={t('admin.accounts.blocked.findAria')} placeholder={t('admin.accounts.blocked.findPlaceholder')} value={query} onChange={(event) => { setQuery(event.target.value); setPicked(null); }} />
        </label>
        {typed && (
          <RefineList as="div" label={t('admin.accounts.users.matching')}>
            {search.searching && <div className="rf-row"><span className="rf-t2" role="status">{t('admin.accounts.users.searching')}</span></div>}
            {hits.map((person) => {
              const open = picked === person.id;
              return (
                <div key={person.id}>
                  <div className="rf-row">
                    <span className="rf-grow"><span className="rf-t1">{person.fullName}</span><span className="rf-t2">{[person.email, accountKind(person.roles), person.isBlocked ? t('admin.accounts.users.blockedTag') : null].filter(Boolean).join(' · ')}</span></span>
                    {!person.isBlocked && <button type="button" className="ops-danger-link" aria-expanded={open} aria-label={t('admin.accounts.users.blockAria', { name: person.fullName })} disabled={busy} onClick={() => { setPicked(open ? null : person.id); setReason(''); }}>{t('admin.accounts.users.block')}</button>}
                  </div>
                  {open && (
                    <div className="ops-reason">
                      <label className="rf-fld">
                        <span>{t('admin.accounts.blocked.reasonLabel')}</span>
                        <input value={reason} maxLength={500} placeholder={t('admin.accounts.blocked.reasonPlaceholder')} onChange={(event) => setReason(event.target.value)} />
                      </label>
                      <span className="ops-acts">
                        <button type="button" className="rf-btn" onClick={() => setPicked(null)}>{t('common.cancel')}</button>
                        <button type="button" className="ops-danger-link" disabled={busy} onClick={() => void block(person)}>{t('admin.accounts.users.blockConfirm')}</button>
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
            {!search.searching && search.failed && <div className="rf-row"><span className="rf-t2">{t('admin.accounts.users.searchFailed')}</span></div>}
            {!search.searching && !search.failed && hits.length === 0 && <div className="rf-row"><span className="rf-t2">{t('admin.accounts.users.noMatch')}</span></div>}
          </RefineList>
        )}

        <h2 className="rf-sec ops-tt-head"><span>{t('admin.accounts.blocked.heading')}</span></h2>
        {blocked === null && <p role="status" className="rf-note">{t('common.loading')}</p>}
        {blocked !== null && (
          <RefineList as="div" label={t('admin.accounts.blocked.heading')}>
            <AnimatePresence initial={false}>
            {blocked.map((account) => (
              <LeavingRow as="div" key={account.id} className="rf-row">
                <span className="rf-grow">
                  <span className="rf-t1">{account.fullName}</span>
                  <span className="rf-t2">{[account.email, account.reason, shortDate(account.blockedAt)].filter(Boolean).join(' · ')}</span>
                </span>
                <button type="button" className="ops-danger-link" aria-label={t('admin.accounts.users.unblockAria', { name: account.fullName })} disabled={busy} onClick={() => void unblock(account)}>{t('admin.accounts.users.unblock')}</button>
              </LeavingRow>
            ))}
            </AnimatePresence>
            {blocked.length === 0 && <div className="rf-row"><span className="rf-t2">{t('admin.accounts.blocked.none')}</span></div>}
          </RefineList>
        )}
        {master && <>
        <h2 className="rf-sec ops-tt-head">Blocked IP addresses</h2>
        {ipError && <Notice role="status">{ipError}</Notice>}
        <RefineList as="div" label="Blocked IP addresses">
          {ipBlocks === null && <div className="rf-row"><span role="status">Loading blocked addresses…</span><button type="button" className="rf-btn" onClick={() => void loadIpBlocks()}>Retry</button></div>}
          {ipBlocks?.map((block) => <div className="rf-row" key={block.id}>
            <span className="rf-grow"><span className="rf-t1">{maskedIp(block.ipAddress)}</span><span className="rf-t2">{[block.reason, shortDate(block.createdAt)].filter(Boolean).join(' · ')}</span></span>
            <button type="button" className="ops-danger-link" disabled={busy} aria-label={`Unblock ${maskedIp(block.ipAddress)}`} onClick={() => void run(async () => { await deleteIpBlock(block.id); await loadIpBlocks(); }, 'Couldn’t unblock that address. Try again.')}>Unblock</button>
          </div>)}
          {ipBlocks?.length === 0 && <div className="rf-row"><span className="rf-t2">No manually blocked addresses.</span></div>}
        </RefineList>
        <button type="button" className="sp-add" aria-expanded={ipFormOpen} onClick={() => setIpFormOpen(!ipFormOpen)}>+ Block an IP address</button>
        {ipFormOpen && <form className="sp-card p-4 space-y-3" onSubmit={(event) => { event.preventDefault(); void addIpBlock(); }}>
          <label className="rf-fld">IP address<input value={ip} maxLength={45} autoComplete="off" onChange={(event) => setIp(event.target.value)} /></label>
          <label className="rf-fld">Reason<input value={ipReason} maxLength={500} onChange={(event) => setIpReason(event.target.value)} /></label>
          <button type="submit" className="ops-danger-link" disabled={busy || !ip.trim()}>Block address</button>
        </form>}
        </>}
      </div>
    </RefinePage>
  );
}
