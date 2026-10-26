import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { signOutDestination } from '../auth/signOutDestination';
import { useAuth } from '../auth/AuthContext';
import { deletionErrorMessage } from '../lib/accountDeletion';
import { Notice } from './Notice';
import { Sheet } from './Sheet';
import './sitePages.css';

/** "Delete my account" as red text. It asks for the password again in a delete-type sheet, then deletes the signed-in person's own account and signs them out. */
export function DeleteAccountPanel() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete('/auth/me', { data: { password } });
      logout();
      navigate(signOutDestination(), { replace: true });
    } catch (e) {
      setError(deletionErrorMessage(e));
      setBusy(false);
    }
  }

  function cancel() {
    setOpen(false);
    setPassword('');
    setError(null);
  }

  return (
    <>
      <button type="button" className="sp-red" onClick={() => setOpen(true)}>Delete my account</button>
      {open && (
        <Sheet
          title="Delete your account?"
          description="Your sign-in, notes, saved riders and notifications go. Chat posts stay, shown as “Deleted user”. You can’t undo this."
          onClose={cancel}
          dismissible={!busy}
          initialFocus="#delete-account-password"
        >
          <form onSubmit={submit} className="kit-sheet-inner">
            <label className="kit-sheet-field" htmlFor="delete-account-password">
              Your password
              <input
                id="delete-account-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && <Notice>{error}</Notice>}
            <div className="kit-acts-del">
              <button type="button" className="kit-pill" onClick={cancel} disabled={busy}>Keep my account</button>
              <button type="submit" className="kit-pill kit-pill-del" disabled={!password || busy}>
                {busy ? 'Deleting…' : 'Delete my account'}
              </button>
            </div>
          </form>
        </Sheet>
      )}
    </>
  );
}
