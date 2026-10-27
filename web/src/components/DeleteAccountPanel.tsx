import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { signOutDestination } from '../auth/signOutDestination';
import { useAuth } from '../auth/AuthContext';
import { useT } from '../i18n/LanguageContext';
import { deletionErrorMessage } from '../lib/accountDeletion';
import { Notice } from './Notice';
import { Sheet } from './Sheet';
import './sitePages.css';

/** "Delete my account" as red text. It asks for the password again in a delete-type sheet, then deletes the signed-in person's own account and signs them out. */
export function DeleteAccountPanel() {
  const t = useT();
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
      <button type="button" className="sp-red" onClick={() => setOpen(true)}>{t('account.delete.button')}</button>
      {open && (
        <Sheet
          title={t('account.delete.title')}
          description={t('account.delete.description')}
          onClose={cancel}
          dismissible={!busy}
          initialFocus="#delete-account-password"
        >
          <form onSubmit={submit} className="kit-sheet-inner">
            <label className="kit-sheet-field" htmlFor="delete-account-password">
              {t('account.delete.password')}
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
              <button type="button" className="kit-pill" onClick={cancel} disabled={busy}>{t('account.delete.keep')}</button>
              <button type="submit" className="kit-pill kit-pill-del" disabled={!password || busy}>
                {busy ? t('account.delete.deleting') : t('account.delete.button')}
              </button>
            </div>
          </form>
        </Sheet>
      )}
    </>
  );
}
