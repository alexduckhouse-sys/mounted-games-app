import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { ChangePasswordSheet } from '../components/ChangePasswordSheet';
import { usePageHeader } from '../components/CompactPageBarContext';
import { DeleteAccountPanel } from '../components/DeleteAccountPanel';
import { Notice } from '../components/Notice';
import { useToast } from '../components/Toast';
import { apiErrorMessage } from '../lib/apiError';
import { roleLabel } from '../lib/profile';
import '../components/sitePages.css';

/** The signed-in person's own details: name (editable in place), email, club, role, password and deleting the account. */
export function AccountPage() {
  const { user, refreshUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const toast = useToast();
  usePageHeader({ title: 'My account', plain: true, backTo: '/me', backLabel: 'Back to Me' });
  if (!user) return null;

  function startEditing() {
    setDraft(user?.fullName ?? '');
    setError(null);
    setEditing(true);
  }

  async function saveName(event: FormEvent) {
    event.preventDefault();
    const name = draft.trim();
    if (!name || busy) return;
    if (name === user?.fullName) { setEditing(false); return; }
    setBusy(true);
    setError(null);
    try {
      await api.put('/auth/me', { fullName: name });
      await refreshUser();
      setEditing(false);
      toast.show('Name saved');
    } catch (e) {
      setError(apiErrorMessage(e, 'Couldn’t save your name. Check your signal and try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="skin mx-auto w-full max-w-[560px] pb-4 pt-3">
      <h1 className="sr-only">My account</h1>
      <h2 className="sp-sec sp-first">You</h2>
      <div className="sp-card">
        {editing ? (
          <form onSubmit={saveName} className="sp-row !items-end">
            <label className="sp-field sp-grow !p-0">
              Name
              <input value={draft} maxLength={100} autoComplete="name" autoFocus onChange={(e) => setDraft(e.target.value)} />
            </label>
            <button type="submit" className="sp-pill sp-pill-fill" disabled={!draft.trim() || busy}>{busy ? 'Saving…' : 'Done'}</button>
          </form>
        ) : (
          <button type="button" className="sp-row" onClick={startEditing} aria-label={`Name: ${user.fullName || 'Not set'}. Change it`}>
            <span className="sp-t1 sp-grow">Name</span>
            <span className="sp-val">{user.fullName || 'Not set'}</span>
            <ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} />
          </button>
        )}
        {error && <div className="px-3.5 py-3"><Notice>{error}</Notice></div>}
        <div className="sp-row"><span className="sp-t1 sp-grow">Email</span><span className="sp-t2 break-all text-right">{user.email}</span></div>
        {user.clubName && <div className="sp-row"><span className="sp-t1 sp-grow">Club</span><span className="sp-t2 text-right">{user.clubName}</span></div>}
        <div className="sp-row"><span className="sp-t1 sp-grow">Role</span><span className="sp-t2 text-right">{roleLabel(user.roles)}</span></div>
        <button type="button" className="sp-row" onClick={() => setPasswordOpen(true)} aria-label="Password: change it">
          <span className="sp-t1 sp-grow">Password</span>
          <span className="sp-val">Change</span>
          <ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} />
        </button>
      </div>
      <p className="sp-note">See what we keep about you on the <Link to="/privacy" className="font-semibold text-[rgb(var(--mg-heading))] underline">privacy page</Link>.</p>
      <div className="mt-4"><DeleteAccountPanel /></div>
      {passwordOpen && <ChangePasswordSheet onClose={() => setPasswordOpen(false)} onChanged={() => { setPasswordOpen(false); toast.show('Password changed'); }} />}
      {toast.node}
    </div>
  );
}
