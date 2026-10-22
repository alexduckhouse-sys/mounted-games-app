import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
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
      navigate('/', { replace: true });
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
    <section aria-labelledby="delete-account-title" className="card space-y-3 p-4">
      <h2 id="delete-account-title" className="text-base font-bold">Delete my account</h2>
      <p className="text-sm">
        This removes your sign-in, your notes, your saved riders and your push notifications. Chat messages and
        marketplace posts you wrote stay, but show as "Deleted user". Competitions you created stay too, with no owner.
        You can't undo it.
      </p>
      {!open ? (
        <button type="button" className="btn-ghost text-rose-700 dark:text-rose-300" onClick={() => setOpen(true)}>
          Delete my account
        </button>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm font-medium" htmlFor="delete-account-password">
            Enter your password to confirm
          </label>
          <input
            id="delete-account-password"
            type="password"
            autoComplete="current-password"
            className="input w-full"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-primary" disabled={!password || busy}>
              {busy ? 'Deleting…' : 'Permanently delete my account'}
            </button>
            <button type="button" className="btn-ghost" onClick={cancel} disabled={busy}>Keep my account</button>
          </div>
        </form>
      )}
    </section>
  );
}
