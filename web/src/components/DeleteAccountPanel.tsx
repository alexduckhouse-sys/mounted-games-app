import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { signOutDestination } from '../auth/signOutDestination';
import { useAuth } from '../auth/AuthContext';
import { useT } from '../i18n/LanguageContext';
import { deletionErrorMessage } from '../lib/accountDeletion';
import type { ExternalProvider } from '../types';
import { Notice } from './Notice';
import { Sheet } from './Sheet';
import { SocialLoginButtons, type SocialCredential } from './SocialLoginButtons';
import './sitePages.css';

interface DeleteAccountPanelProps {
  /** False for an account made with a provider and no password. Unknown (still loading) is treated as true. */
  hasPassword?: boolean;
  /** The providers linked to the account, which can confirm a passwordless deletion. */
  linkedProviders?: string[];
}

const isProviderId = (id: string): id is ExternalProvider['id'] => id === 'google' || id === 'apple' || id === 'facebook';

/**
 * "Delete my account" as red text. It asks for the password again in a delete-type sheet (or, for an account with no
 * password, a fresh sign-in with one of its own providers), then deletes the signed-in person's own account and signs them out.
 */
export function DeleteAccountPanel({ hasPassword = true, linkedProviders = [] }: DeleteAccountPanelProps) {
  const t = useT();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmWith = linkedProviders.filter(isProviderId);

  async function remove(body: { password: string } | { provider: string; idToken: string; nonce?: string }) {
    setBusy(true);
    setError(null);
    try {
      await api.delete('/auth/me', { data: body });
      logout();
      navigate(signOutDestination(), { replace: true });
    } catch (e) {
      setError(deletionErrorMessage(e));
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!password || busy) return;
    void remove({ password });
  }

  function confirmed({ provider, idToken, nonce }: SocialCredential) {
    void remove({ provider, idToken, nonce });
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
          initialFocus={hasPassword ? '#delete-account-password' : undefined}
        >
          {hasPassword ? (
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
          ) : (
            <div className="kit-sheet-inner">
              <p className="m-0">{confirmWith.length > 0 ? t('account.delete.confirmWithProvider') : t('account.delete.noWayToConfirm')}</p>
              {confirmWith.length > 0 && (
                <SocialLoginButtons only={confirmWith} divider={false} disabled={busy} onCredential={confirmed} onError={setError} />
              )}
              {error && <Notice>{error}</Notice>}
              <div className="kit-acts-del">
                <button type="button" className="kit-pill" onClick={cancel} disabled={busy}>{t('account.delete.keep')}</button>
              </div>
            </div>
          )}
        </Sheet>
      )}
    </>
  );
}
