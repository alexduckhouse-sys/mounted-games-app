import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../../api';
import { confirmDialog } from '../../components/ConfirmDialog';
import { problemMessage } from '../../lib/apiError';
import { RefineHeader, RefineList, RefinePage } from '../refine/Refine';
import { accountKind, type AdminUser, type BlockedAccount } from './accountAccessTypes';
import { useAccountSearch } from './useAccountSearch';
import '../operations/operations.css';

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** Find an account, block it with a reason only admins see, and unblock accounts from the list below. */
export function BlockedAccountsPage() {
  const [blocked, setBlocked] = useState<BlockedAccount[] | null>(null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const search = useAccountSearch(query);

  const load = () => api.get<BlockedAccount[]>('/admin/blocked-users')
    .then(({ data }) => setBlocked(Array.isArray(data) ? data : []))
    .catch(() => { setBlocked((current) => current ?? []); setError('Couldn’t load the blocked accounts. Try again.'); });
  useEffect(() => {
    void load();
  }, []);

  async function run(work: () => Promise<void>, failure: string) {
    setBusy(true);
    setError(null);
    try { await work(); } catch (caught) { setError(problemMessage(caught, failure)); } finally { setBusy(false); }
  }

  async function block(person: AdminUser) {
    if (!(await confirmDialog({ title: `Block ${person.fullName}?`, message: 'They can’t sign in, enter competitions or post in chat, and the internet addresses they use are blocked too.', confirmLabel: 'Block account', destructive: true }))) return;
    await run(async () => {
      await api.post(`/admin/users/${encodeURIComponent(person.id)}/block`, { reason: reason.trim() || null });
      search.patch(person.id, { isBlocked: true });
      setPicked(null);
      setReason('');
      await load();
    }, `Couldn’t block ${person.fullName}. Try again.`);
  }

  async function unblock(account: BlockedAccount) {
    await run(async () => {
      await api.delete(`/admin/users/${encodeURIComponent(account.id)}/block`);
      search.patch(account.id, { isBlocked: false });
      setBlocked((current) => (current ?? []).filter((b) => b.id !== account.id));
    }, `Couldn’t unblock ${account.fullName}. Try again.`);
  }

  const typed = query.trim().length > 0;
  const hits = search.results ?? [];

  return (
    <RefinePage>
      <RefineHeader back="/admin" backLabel="Back to site admin" context="Site admin" title="Blocked accounts" />
      <div className="ops-cards ops-tt ops-admin ops-people" aria-busy={busy}>
        {error && <p role="alert" className="mg-notice ops-alert">{error}</p>}

        <label className="ops-search">
          <Search className="h-[18px] w-[18px]" aria-hidden="true" />
          <input type="search" aria-label="Find an account" placeholder="Find an account by name or email" value={query} onChange={(event) => { setQuery(event.target.value); setPicked(null); }} />
        </label>
        {typed && (
          <RefineList as="div" label="Matching accounts">
            {search.searching && <div className="rf-row"><span className="rf-t2" role="status">Searching…</span></div>}
            {hits.map((person) => {
              const open = picked === person.id;
              return (
                <div key={person.id}>
                  <div className="rf-row">
                    <span className="rf-grow"><span className="rf-t1">{person.fullName}</span><span className="rf-t2">{[person.email, accountKind(person.roles), person.isBlocked ? 'blocked' : null].filter(Boolean).join(' · ')}</span></span>
                    {!person.isBlocked && <button type="button" className="ops-danger-link" aria-expanded={open} aria-label={`Block ${person.fullName}`} disabled={busy} onClick={() => { setPicked(open ? null : person.id); setReason(''); }}>Block</button>}
                  </div>
                  {open && (
                    <div className="ops-reason">
                      <label className="rf-fld">
                        <span>Reason (only admins see it)</span>
                        <input value={reason} maxLength={500} placeholder="Spam in chat" onChange={(event) => setReason(event.target.value)} />
                      </label>
                      <span className="ops-acts">
                        <button type="button" className="rf-btn" onClick={() => setPicked(null)}>Cancel</button>
                        <button type="button" className="ops-danger-link" disabled={busy} onClick={() => void block(person)}>Block account</button>
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
            {!search.searching && search.failed && <div className="rf-row"><span className="rf-t2">Couldn’t search. Try again.</span></div>}
            {!search.searching && !search.failed && hits.length === 0 && <div className="rf-row"><span className="rf-t2">No account matches that</span></div>}
          </RefineList>
        )}

        <h2 className="rf-sec ops-tt-head"><span>Blocked</span></h2>
        {blocked === null && <p role="status" className="rf-note">Loading…</p>}
        {blocked !== null && (
          <RefineList as="div" label="Blocked">
            {blocked.map((account) => (
              <div key={account.id} className="rf-row">
                <span className="rf-grow">
                  <span className="rf-t1">{account.fullName}</span>
                  <span className="rf-t2">{[account.email, account.reason, shortDate(account.blockedAt)].filter(Boolean).join(' · ')}</span>
                </span>
                <button type="button" className="ops-danger-link" aria-label={`Unblock ${account.fullName}`} disabled={busy} onClick={() => void unblock(account)}>Unblock</button>
              </div>
            ))}
            {blocked.length === 0 && <div className="rf-row"><span className="rf-t2">No one is blocked</span></div>}
          </RefineList>
        )}
      </div>
    </RefinePage>
  );
}
