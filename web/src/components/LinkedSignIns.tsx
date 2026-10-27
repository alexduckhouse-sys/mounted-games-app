import { useState } from 'react';
import type { LinkedSignInsState } from '../hooks/useLinkedSignIns';
import { useT } from '../i18n/LanguageContext';
import { externalErrorMessage } from '../lib/externalAuthError';
import { confirmDialog } from './ConfirmDialog';
import { Notice } from './Notice';
import { SocialLoginButtons, useSocialProviders, type SocialCredential } from './SocialLoginButtons';
import './sitePages.css';

interface LinkedSignInsProps extends LinkedSignInsState {
  /** A short "Google added" for the page's toast. */
  onChanged: (message: string) => void;
}

/**
 * "Ways to sign in" on My account: the Google and Apple sign-ins linked to the account, each with Remove, and the
 * providers' own "Continue with …" buttons to add the others. The last way into an account with no password can't be
 * removed (the API refuses too). Adding one emails the account's address.
 */
export function LinkedSignIns({ info, connect, remove, onChanged }: LinkedSignInsProps) {
  const t = useT();
  const providers = useSocialProviders();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!info) return null;

  const linked = new Set(info.logins.map((l) => l.provider));
  const addable = providers.filter((p) => !linked.has(p.id));
  if (info.logins.length === 0 && addable.length === 0) return null;
  const lastWayIn = !info.hasPassword && info.logins.length === 1;

  async function add(credential: SocialCredential) {
    setBusy(true);
    setError(null);
    try {
      await connect(credential);
      // The button came from this list, so the provider is in it.
      onChanged(t('account.signIns.added', { name: addable.find((p) => p.id === credential.provider)!.name }));
    } catch (e) {
      setError(externalErrorMessage(e, t('account.signIns.failed')));
    } finally {
      setBusy(false);
    }
  }

  async function removeOne(provider: string, name: string) {
    const sure = await confirmDialog({
      title: t('account.signIns.removeTitle', { name }),
      message: t('account.signIns.removeMessage', { name }),
      confirmLabel: t('account.signIns.remove'),
      destructive: true,
    });
    if (!sure) return;
    setBusy(true);
    setError(null);
    try {
      await remove(provider);
      onChanged(t('account.signIns.removed', { name }));
    } catch (e) {
      setError(externalErrorMessage(e, t('account.signIns.failed')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="ways-to-sign-in">
      <h2 id="ways-to-sign-in" className="sp-sec">{t('account.signIns.heading')}</h2>
      {info.logins.length > 0 && (
        <div className="sp-card">
          {info.logins.map((login) => (
            <div key={login.provider} className="sp-row">
              <span className="sp-t1 sp-grow">{login.name}</span>
              {lastWayIn
                ? <span className="sp-t2">{t('account.signIns.onlyWayIn')}</span>
                : (
                  <button type="button" className="sp-red" disabled={busy} onClick={() => removeOne(login.provider, login.name)}
                    aria-label={t('account.signIns.removeAria', { name: login.name })}>
                    {t('account.signIns.remove')}
                  </button>
                )}
            </div>
          ))}
        </div>
      )}
      {lastWayIn && <p className="sp-note">{t('account.signIns.onlyWayInNote')}</p>}
      {addable.length > 0 && (
        <div className="mt-3 flex flex-col gap-2.5">
          <p className="sp-note !mt-0">{t('account.signIns.add')}</p>
          <SocialLoginButtons only={addable.map((p) => p.id)} divider={false} label="continue" disabled={busy} onCredential={add} onError={setError} />
        </div>
      )}
      {error && <div className="mt-3"><Notice>{error}</Notice></div>}
    </section>
  );
}
