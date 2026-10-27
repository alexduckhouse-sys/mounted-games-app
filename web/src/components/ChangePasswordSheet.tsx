import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { apiErrorMessage } from '../lib/apiError';
import { passwordMeetsRules } from '../lib/passwordRules';
import { Notice } from './Notice';
import { PasswordChecklist } from './PasswordChecklist';
import { Sheet } from './Sheet';

/**
 * Asks for the current password and a new one, then changes the signed-in person's own password. That signs every other
 * device out; this one carries on with the fresh sign-in the API sends back.
 */
export function ChangePasswordSheet({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { changePassword } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = current !== '' && passwordMeetsRules(next);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
      onChanged();
    } catch (e) {
      setError(apiErrorMessage(e, 'Couldn’t change your password. Check your signal and try again.'));
      setBusy(false);
    }
  }

  return (
    <Sheet title="Change password" onClose={onClose} dismissible={!busy} initialFocus="#change-password-current">
      {({ close }) => (
        <form onSubmit={submit} className="kit-sheet-inner">
          <label className="kit-sheet-field" htmlFor="change-password-current">
            Current password
            <input id="change-password-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </label>
          <label className="kit-sheet-field" htmlFor="change-password-new">
            New password
            <input id="change-password-new" type="password" autoComplete="new-password" aria-describedby="change-password-rules" value={next} onChange={(e) => setNext(e.target.value)} />
          </label>
          <PasswordChecklist password={next} id="change-password-rules" />
          {error && <Notice>{error}</Notice>}
          <div className="kit-acts">
            <button type="submit" className="kit-pill kit-pill-fill" disabled={!ready || busy}>{busy ? 'Changing…' : 'Change password'}</button>
            <button type="button" className="kit-pill" onClick={() => close()} disabled={busy}>Cancel</button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
