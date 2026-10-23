import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { signOutDestination } from '../auth/signOutDestination';
import { useAuth } from '../auth/AuthContext';
import { deletionErrorMessage } from '../lib/accountDeletion';

/** Asks for the password again, then deletes the signed-in person's own account and signs them out. */
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
    <section aria-labelledby="delete-account-title" className="mg-card space-y-3 p-4">
      <h2 id="delete-account-title" className="mg-h2">Delete my account</h2>
      <p className="mg-lede">
        This removes your sign-in, your notes, your saved riders and your push notifications. Chat messages and
        marketplace posts you wrote stay, but show as "Deleted user". Competitions you created stay too, with no owner.
        You can't undo it.
      </p>
      {!open ? (
        <button type="button" className="mg-btn mg-btn-secondary" onClick={() => setOpen(true)}>
          Delete my account
        </button>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <label className="mg-lede block font-semibold" htmlFor="delete-account-password">
            Enter your password to confirm
          </label>
          <input
            id="delete-account-password"
            type="password"
            autoComplete="current-password"
            className="mg-field w-full px-3 !text-[rgb(var(--mg-ink))]"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p role="alert" className="mg-notice">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="mg-btn mg-btn-primary" disabled={!password || busy}>
              {busy ? 'Deleting…' : 'Permanently delete my account'}
            </button>
            <button type="button" className="mg-btn mg-btn-secondary" onClick={cancel} disabled={busy}>Keep my account</button>
          </div>
        </form>
      )}
    </section>
  );
}
